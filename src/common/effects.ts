// Effect API implementations for token metadata fetching
// This replaces direct RPC calls with Envio's Effect API for better performance

import { experimental_createEffect, S } from "envio";
import { createPublicClient, http, parseAbi } from 'viem';
import * as dotenv from 'dotenv';
import { getStaticDefinition, SKIP_TOTAL_SUPPLY } from './tokenDefinition';
import { ZERO_BI } from './constants';

// Load environment variables
dotenv.config();

// ERC20 ABI for basic token functions
const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]);

// ERC20 Symbol Bytes ABI for fallback
const ERC20_SYMBOL_BYTES_ABI = parseAbi([
  'function symbol() view returns (bytes32)',
]);

// ERC20 Name Bytes ABI for fallback
const ERC20_NAME_BYTES_ABI = parseAbi([
  'function name() view returns (bytes32)',
]);

// Create a public client with batching enabled for better performance
const publicClient = createPublicClient({
  chain: {
    id: 10143,
    name: 'Custom Chain',
    network: 'custom',
    nativeCurrency: {
      decimals: 18,
      name: 'Native Token',
      symbol: 'NATIVE',
    },
    rpcUrls: {
      default: {
        http: [process.env.ENVIO_CHAIN_10143_RPC_URL || 'http://localhost:8545'],
      },
      public: {
        http: [process.env.ENVIO_CHAIN_10143_RPC_URL || 'http://localhost:8545'],
      },
    },
  },
  // Enable batching to group calls into fewer RPC requests
  transport: http(process.env.ENVIO_CHAIN_10143_RPC_URL || 'http://localhost:8545', { batch: true }),
});

// Helper function to check for null ETH values
function isNullEthValue(value: string): boolean {
  return value == '0x0000000000000000000000000000000000000000000000000000000000000001';
}

// Effect to fetch token symbol with fallback logic
export const getTokenSymbol = experimental_createEffect(
  {
    name: "getTokenSymbol",
    input: S.string, // token address
    output: S.string, // symbol
    cache: true, // Enable caching for better performance
  },
  async ({ input: tokenAddress, context }) => {
    try {
      // Static definitions overrides
      const staticDefinition = getStaticDefinition(tokenAddress);
      if (staticDefinition !== null) {
        context.log.info(`Using static definition for token symbol: ${tokenAddress}`);
        return staticDefinition.symbol;
      }

      // Try standard ERC20 symbol first
      const symbol = await publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'symbol',
      });
      
      if (symbol && symbol !== '') {
        context.log.info(`Fetched symbol for token ${tokenAddress}: ${symbol}`);
        return symbol;
      }
    } catch (error) {
      // Fallback to bytes32 symbol for broken tokens
      try {
        const symbolBytes = await publicClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_SYMBOL_BYTES_ABI,
          functionName: 'symbol',
        });
        
        if (symbolBytes && !isNullEthValue(symbolBytes)) {
          context.log.info(`Fetched bytes32 symbol for token ${tokenAddress}: ${symbolBytes}`);
          return symbolBytes;
        }
      } catch (fallbackError) {
        context.log.warn(`Both symbol attempts failed for token ${tokenAddress}`);
      }
    }
    
    context.log.warn(`Returning 'unknown' symbol for token ${tokenAddress}`);
    return 'unknown';
  }
);

// Effect to fetch token name with fallback logic
export const getTokenName = experimental_createEffect(
  {
    name: "getTokenName",
    input: S.string, // token address
    output: S.string, // name
    cache: true, // Enable caching for better performance
  },
  async ({ input: tokenAddress, context }) => {
    try {
      // Static definitions overrides
      const staticDefinition = getStaticDefinition(tokenAddress);
      if (staticDefinition !== null) {
        context.log.info(`Using static definition for token name: ${tokenAddress}`);
        return staticDefinition.name;
      }

      // Try standard ERC20 name first
      const name = await publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'name',
      });
      
      if (name && name !== '') {
        context.log.info(`Fetched name for token ${tokenAddress}: ${name}`);
        return name;
      }
    } catch (error) {
      // Fallback to bytes32 name for broken tokens
      try {
        const nameBytes = await publicClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_NAME_BYTES_ABI,
          functionName: 'name',
        });
        
        if (nameBytes && !isNullEthValue(nameBytes)) {
          context.log.info(`Fetched bytes32 name for token ${tokenAddress}: ${nameBytes}`);
          return nameBytes;
        }
      } catch (fallbackError) {
        context.log.warn(`Both name attempts failed for token ${tokenAddress}`);
      }
    }
    
    context.log.warn(`Returning 'unknown' name for token ${tokenAddress}`);
    return 'unknown';
  }
);

// Effect to fetch token decimals
export const getTokenDecimals = experimental_createEffect(
  {
    name: "getTokenDecimals",
    input: S.string, // token address
    output: S.optional(S.bigint), // decimals (optional since it can fail)
    cache: true, // Enable caching for better performance
  },
  async ({ input: tokenAddress, context }) => {
    try {
      // Static definitions overrides
      const staticDefinition = getStaticDefinition(tokenAddress);
      if (staticDefinition !== null) {
        context.log.info(`Using static definition for token decimals: ${tokenAddress}`);
        return BigInt(staticDefinition.decimals);
      }

      const decimals = await publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'decimals',
      });
      
      if (decimals !== null && decimals !== undefined) {
        context.log.info(`Fetched decimals for token ${tokenAddress}: ${decimals}`);
        return BigInt(decimals);
      }
    } catch (error) {
      context.log.warn(`Decimals call failed for token ${tokenAddress}: ${error}`);
    }
    
    context.log.warn(`Returning undefined decimals for token ${tokenAddress}`);
    return undefined;
  }
);

// Effect to fetch token total supply
export const getTokenTotalSupply = experimental_createEffect(
  {
    name: "getTokenTotalSupply",
    input: S.string, // token address
    output: S.bigint, // total supply
    cache: true, // Enable caching for better performance
  },
  async ({ input: tokenAddress, context }) => {
    try {
      // Skip specific tokens that have issues with totalSupply
      if (SKIP_TOTAL_SUPPLY.includes(tokenAddress.toLowerCase())) {
        context.log.info(`Skipping totalSupply for token ${tokenAddress} (in SKIP_TOTAL_SUPPLY list)`);
        return ZERO_BI;
      }

      const totalSupply = await publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'totalSupply',
      });
      
      if (totalSupply !== null && totalSupply !== undefined) {
        context.log.info(`Fetched totalSupply for token ${tokenAddress}: ${totalSupply}`);
        return totalSupply;
      }
    } catch (error) {
      context.log.warn(`TotalSupply call failed for token ${tokenAddress}: ${error}`);
    }
    
    context.log.warn(`Returning ZERO_BI totalSupply for token ${tokenAddress}`);
    return ZERO_BI;
  }
);
