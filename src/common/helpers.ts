// Helper functions from original subgraph helpers
// Reference: original-subgraph/src/common/helpers.ts

import { ZERO_BI, ZERO_BD, ONE_BI } from './constants';
import { BigDecimal } from 'generated';

// TODO: These functions need to be implemented using Envio's approach
// For now, returning placeholder values to allow compilation
// In production, these would use RPC calls or other data sources

export function exponentToBigDecimal(decimals: bigint): BigDecimal {
  let bd = new BigDecimal(1);
  for (let i = ZERO_BI; i < decimals; i = i + ONE_BI) {
    bd = bd.times(new BigDecimal(10));
  }
  return bd;
}

export function bigDecimalExp18(): BigDecimal {
  return new BigDecimal('1000000000000000000');
}

export function convertEthToDecimal(eth: bigint): BigDecimal {
  return new BigDecimal(eth.toString()).div(exponentToBigDecimal(BigInt(18)));
}

export function convertTokenToDecimal(tokenAmount: bigint, exchangeDecimals: bigint): BigDecimal {
  if (exchangeDecimals == ZERO_BI) {
    return new BigDecimal(tokenAmount.toString());
  }
  return new BigDecimal(tokenAmount.toString()).div(exponentToBigDecimal(exchangeDecimals));
}

export function equalToZero(value: BigDecimal): boolean {
  return value.isEqualTo(ZERO_BD);
}

export function isNullEthValue(value: string): boolean {
  return value == '0x0000000000000000000000000000000000000000000000000000000000000001';
}

// TODO: Implement these using Envio's approach (RPC calls, etc.)
export function fetchTokenSymbol(tokenAddress: string): string {
  // TODO: Implement token symbol fetching
  // For now, return placeholder
  return 'UNKNOWN';
}

export function fetchTokenName(tokenAddress: string): string {
  // TODO: Implement token name fetching
  // For now, return placeholder
  return 'Unknown Token';
}

export function fetchTokenDecimals(tokenAddress: string): bigint | null {
  // TODO: Implement token decimals fetching
  // For now, return placeholder
  return BigInt(18);
}

export function fetchTokenTotalSupply(tokenAddress: string): bigint {
  // TODO: Implement token total supply fetching
  // For now, return placeholder
  // Note: Token entity expects bigint, not BigDecimal
  return ZERO_BI;
}

export function createUser(address: string): void {
  // TODO: Implement user creation
  // This would create or load a User entity
}
