// Core event handlers for Uniswap V2 Pair contract
// Reference: original-subgraph/src/v2/mappings/core.ts

import {
  Pair,
} from "generated";
import {
  Mint_t,
  Burn_t,
  Swap_t,
  Transaction_t,
  Token_t,
  Pair_t,
  UniswapFactory_t,
  Bundle_t,
  PairDayData_t,
  TokenDayData_t,
  PairHourData_t,
  TokenHourData_t,
  UniswapDayData_t,
} from "generated/src/db/Entities.gen";
import { ADDRESS_ZERO, ZERO_BD, ZERO_BI, ONE_BI, BI_18, ALMOST_ZERO_BD } from "../../common/constants";
import { getFactoryAddress } from "../../common/chainConfig";
import { BigDecimal } from "generated";
import { convertTokenToDecimal, createUser } from "../../common/helpers";
import { getTrackedVolumeUSD, getEthPriceInUSD, findEthPerToken, getTrackedLiquidityUSD } from "../../common/pricing";
import { updatePairDayData, updatePairHourData, updateUniswapDayData, updateTokenDayData, updateTokenHourData } from "../../common/hourDayUpdates";

// Implement handleMint function
// Reference: original-subgraph/src/v2/mappings/core.ts - handleMint
Pair.Mint.handler(async ({ event, context }) => {
  try {
    // 1. Load Transaction entity (created by handleTransfer)
    const chainId = event.chainId;
    const transactionId = `${chainId}-${event.transaction.hash}`;
    const transaction = await context.Transaction.get(transactionId);
    if (!transaction) {
      return;
    }

    // 2. Load or create Mint entity
    const mintId = `${transactionId}-${event.logIndex}`;
    let mint = await context.Mint.get(mintId);
    if (!mint) {
      mint = {
        id: mintId,
        transaction_id: transactionId,
        timestamp: BigInt(event.block.timestamp),
        pair_id: `${chainId}-${event.srcAddress}`,
        to: ADDRESS_ZERO,
        liquidity: ZERO_BD,
        sender: undefined,
        amount0: undefined,
        amount1: undefined,
        logIndex: BigInt(event.logIndex),
        amountUSD: undefined,
        feeTo: undefined,
        feeLiquidity: undefined,
      };
      context.Mint.set(mint);
    }

    // 3. Load Pair and UniswapFactory entities
    const pair = await context.Pair.get(`${chainId}-${event.srcAddress}`);
    if (!pair) {
      return;
    }

    const factoryAddress = getFactoryAddress(chainId);
    const factory = await context.UniswapFactory.get(`${chainId}-${factoryAddress}`);
    if (!factory) {
      return;
    }

    // 4. Load Token entities for token0 and token1
    const token0 = await context.Token.get(pair.token0_id);
    if (!token0) {
      return;
    }

    const token1 = await context.Token.get(pair.token1_id);
    if (!token1) {
      return;
    }

    // Log mint event

    // 5. Calculate amounts and update entities
    const amount0 = convertTokenToDecimal(event.params.amount0, BigInt(token0.decimals));
    const amount1 = convertTokenToDecimal(event.params.amount1, BigInt(token1.decimals));

    // Update token amounts
    const updatedToken0: Token_t = {
      ...token0,
      totalLiquidity: token0.totalLiquidity.plus(amount0),
      txCount: token0.txCount + BigInt(1),
    };

    const updatedToken1: Token_t = {
      ...token1,
      totalLiquidity: token1.totalLiquidity.plus(amount1),
      txCount: token1.txCount + BigInt(1),
    };

    // Update pair reserves
    const updatedPair: Pair_t = {
      ...pair,
      reserve0: pair.reserve0.plus(amount0),
      reserve1: pair.reserve1.plus(amount1),
      totalSupply: pair.totalSupply.plus(mint.liquidity),
    };

    // Update factory
    const updatedFactory: UniswapFactory_t = { ...factory, txCount: factory.txCount + ONE_BI };

    // 6. Calculate USD value using derivedETH values
    const mintBundle = await context.Bundle.get(`${chainId}-1`);
    let amountTotalUSD = ZERO_BD;
    
    if (mintBundle && mintBundle.ethPrice && mintBundle.ethPrice.isGreaterThan(ZERO_BD)) {
      // Calculate USD value: (amount1 * token1.derivedETH + amount0 * token0.derivedETH) * bundle.ethPrice
      amountTotalUSD = token1.derivedETH
        .times(amount1)
        .plus(token0.derivedETH.times(amount0))
        .times(mintBundle.ethPrice);
    }

    // Update mint entity with all required fields
    const updatedMint: Mint_t = {
      ...mint,
      amount0: amount0,
      amount1: amount1,
      sender: event.params.sender,
      amountUSD: amountTotalUSD,
      feeTo: undefined,
      feeLiquidity: undefined,
    };

    // Save all entities
    context.Token.set(updatedToken0);
    context.Token.set(updatedToken1);
    context.Pair.set(updatedPair);
    context.UniswapFactory.set(updatedFactory);
    context.Mint.set(updatedMint);

    // 6. Update daily/hourly data
    const bundle = await context.Bundle.get(`${chainId}-1`);
    if (bundle && !context.isPreload) {
      await updatePairDayData(updatedPair, event, context, String(chainId));
      await updatePairHourData(updatedPair, event, context, String(chainId));
      await updateUniswapDayData(event, context, String(chainId));
      await updateTokenDayData(updatedToken0, event, context, String(chainId));
      await updateTokenDayData(updatedToken1, event, context, String(chainId));
    }

  } catch (error) {
    context.log.error(`Error in handleMint: ${error}`);
  }
});

// Implement handleBurn function
// Reference: original-subgraph/src/v2/mappings/core.ts - handleBurn
Pair.Burn.handler(async ({ event, context }) => {
  try {
    // 1. Load Transaction entity
    const chainId = event.chainId;
    const transactionId = `${chainId}-${event.transaction.hash}`;
    const transaction = await context.Transaction.get(transactionId);
    if (!transaction) {
      return;
    }

    // 2. Load or create Burn entity
    const burnId = `${transactionId}-${event.logIndex}`;
    let burn = await context.Burn.get(burnId);
    if (!burn) {
      burn = {
        id: burnId,
        transaction_id: transactionId,
        timestamp: BigInt(event.block.timestamp),
        pair_id: `${chainId}-${event.srcAddress}`,
        to: event.params.to,
        liquidity: ZERO_BD,
        sender: undefined,
        amount0: undefined,
        amount1: undefined,
        logIndex: BigInt(event.logIndex),
        amountUSD: undefined,
        needsComplete: true,
        feeTo: undefined,
        feeLiquidity: undefined,
      };
      context.Burn.set(burn);
    }

    // 3. Load Pair and UniswapFactory entities
    const pair = await context.Pair.get(`${chainId}-${event.srcAddress}`);
    if (!pair) {
      return;
    }

    const factoryAddress = getFactoryAddress(chainId);
    const factory = await context.UniswapFactory.get(`${chainId}-${factoryAddress}`);
    if (!factory) {
      return;
    }

    // 4. Load Token entities for token0 and token1
    const token0 = await context.Token.get(pair.token0_id);
    if (!token0) {
      return;
    }

    const token1 = await context.Token.get(pair.token1_id);
    if (!token1) {
      return;
    }

    // 5. Calculate amounts and update entities
    const amount0 = convertTokenToDecimal(event.params.amount0, BigInt(token0.decimals));
    const amount1 = convertTokenToDecimal(event.params.amount1, BigInt(token1.decimals));

    // Update token amounts
    const updatedToken0: Token_t = {
      ...token0,
      totalLiquidity: token0.totalLiquidity.minus(amount0),
      txCount: token0.txCount + BigInt(1),
    };

    const updatedToken1: Token_t = {
      ...token1,
      totalLiquidity: token1.totalLiquidity.minus(amount1),
      txCount: token1.txCount + BigInt(1),
    };

    // Update pair reserves
    const updatedPair: Pair_t = {
      ...pair,
      reserve0: pair.reserve0.minus(amount0),
      reserve1: pair.reserve1.minus(amount1),
      totalSupply: pair.totalSupply.minus(burn.liquidity),
    };

    // Update factory
    const updatedFactory: UniswapFactory_t = { ...factory, txCount: factory.txCount + ONE_BI };

    // 6. Calculate USD value using derivedETH values
    const burnBundle = await context.Bundle.get(`${chainId}-1`);
    let amountTotalUSD = ZERO_BD;
    
    if (burnBundle && burnBundle.ethPrice && burnBundle.ethPrice.isGreaterThan(ZERO_BD)) {
      // Calculate USD value: (amount1 * token1.derivedETH + amount0 * token0.derivedETH) * bundle.ethPrice
      amountTotalUSD = token1.derivedETH
        .times(amount1)
        .plus(token0.derivedETH.times(amount0))
        .times(burnBundle.ethPrice);
    }

    // Update burn entity
    const updatedBurn: Burn_t = {
      ...burn,
      amount0: amount0,
      amount1: amount1,
      liquidity: burn.liquidity,
      amountUSD: amountTotalUSD,
      needsComplete: false,
    };

    // Save all entities
    context.Token.set(updatedToken0);
    context.Token.set(updatedToken1);
    context.Pair.set(updatedPair);
    context.UniswapFactory.set(updatedFactory);
    context.Burn.set(updatedBurn);

    // 6. Update daily/hourly data
    const bundle = await context.Bundle.get(`${chainId}-1`);
    if (bundle && !context.isPreload) {
      await updatePairDayData(updatedPair, event, context, String(chainId));
      await updatePairHourData(updatedPair, event, context, String(chainId));
      await updateUniswapDayData(event, context, String(chainId));
      await updateTokenDayData(updatedToken0, event, context, String(chainId));
      await updateTokenDayData(updatedToken1, event, context, String(chainId));
    }

  } catch (error) {
    context.log.error(`Error in handleBurn: ${error}`);
  }
});

// Implement handleSwap function
// Reference: original-subgraph/src/v2/mappings/core.ts - handleSwap
Pair.Swap.handler(async ({ event, context }) => {
  try {
    // 1. Load Pair and UniswapFactory entities
    const chainId = event.chainId;
    let pair = await context.Pair.get(`${chainId}-${event.srcAddress}`);
    if (!pair) {
      return;
    }

    const factoryAddress = getFactoryAddress(chainId);
    const factory = await context.UniswapFactory.get(`${chainId}-${factoryAddress}`);
    if (!factory) {
      return;
    }

    // 2. Load Token entities for token0 and token1
    const token0 = await context.Token.get(pair.token0_id);
    if (!token0) {
      return;
    }

    const token1 = await context.Token.get(pair.token1_id);
    if (!token1) {
      return;
    }

    // 3. Calculate amounts
    const amount0In = convertTokenToDecimal(event.params.amount0In, BigInt(token0.decimals));
    const amount1In = convertTokenToDecimal(event.params.amount1In, BigInt(token1.decimals));
    const amount0Out = convertTokenToDecimal(event.params.amount0Out, BigInt(token0.decimals));
    const amount1Out = convertTokenToDecimal(event.params.amount1Out, BigInt(token1.decimals));

    // 4. Update pair reserves
    const reserve0 = pair.reserve0.plus(amount0In).minus(amount0Out);
    const reserve1 = pair.reserve1.plus(amount1In).minus(amount1Out);

    // 5. Calculate volume and fees
    const volume0 = amount0In.plus(amount0Out);
    const volume1 = amount1In.plus(amount1Out);

    // 6. Update pair entity
    pair = {
      ...pair,
      reserve0: reserve0,
      reserve1: reserve1,
      volumeToken0: pair.volumeToken0.plus(volume0),
      volumeToken1: pair.volumeToken1.plus(volume1),
      txCount: pair.txCount + BigInt(1),
    };

    // 7. Update token entities
    const updatedToken0: Token_t = {
      ...token0,
      tradeVolume: token0.tradeVolume.plus(volume0),
      txCount: token0.txCount + BigInt(1),
    };

    const updatedToken1: Token_t = {
      ...token1,
      tradeVolume: token1.tradeVolume.plus(volume1),
      txCount: token1.txCount + BigInt(1),
    };

    // 8. Calculate USD values
    const bundle = await context.Bundle.get(`${chainId}-1`);
    let finalToken0: Token_t | undefined;
    let finalToken1: Token_t | undefined;
    
    if (bundle) {
      const volumeUSD = await getTrackedVolumeUSD(amount0In, token0, amount1In, token1, pair, context, Number(chainId));
      const volumeETH = volumeUSD.div(bundle.ethPrice);

      // Update pair with USD values
      pair = {
        ...pair,
        volumeUSD: pair.volumeUSD.plus(volumeUSD),
      };

      // Update tokens with USD values - create new objects to avoid read-only issues
      finalToken0 = {
        ...updatedToken0,
        tradeVolumeUSD: updatedToken0.tradeVolumeUSD.plus(volumeUSD),
      };

      finalToken1 = {
        ...updatedToken1,
        tradeVolumeUSD: updatedToken1.tradeVolumeUSD.plus(volumeUSD),
      };

      // Update factory
      const updatedFactory: UniswapFactory_t = {
        ...factory,
        totalVolumeUSD: factory.totalVolumeUSD.plus(volumeUSD),
        totalVolumeETH: factory.totalVolumeETH.plus(volumeETH),
        txCount: factory.txCount + BigInt(1),
      };

      // Save factory
      context.UniswapFactory.set(updatedFactory);

      // Save updated tokens
      context.Token.set(finalToken0);
      context.Token.set(finalToken1);
    }

    // 9. Create Swap entity
    const transactionId = `${chainId}-${event.transaction.hash}`;
    const swapId = `${transactionId}-${event.logIndex}`;
    
    // Calculate USD value for swap
    let swapAmountUSD = ZERO_BD;
    if (bundle && bundle.ethPrice && bundle.ethPrice.isGreaterThan(ZERO_BD)) {
      // Calculate volume in USD using derivedETH values
      const volume0USD = volume0.times(token0.derivedETH).times(bundle.ethPrice);
      const volume1USD = volume1.times(token1.derivedETH).times(bundle.ethPrice);
      swapAmountUSD = volume0USD.plus(volume1USD).div(new BigDecimal(2)); // Average of both amounts
    }
    
    const swap: Swap_t = {
      id: swapId,
      transaction_id: transactionId,
      timestamp: BigInt(event.block.timestamp),
      pair_id: pair.id,
      sender: event.params.sender,
      from: event.params.sender, // Use sender as from since 'from' doesn't exist
      amount0In: amount0In,
      amount1In: amount1In,
      amount0Out: amount0Out,
      amount1Out: amount1Out,
      to: event.params.to,
      logIndex: BigInt(event.logIndex),
      amountUSD: swapAmountUSD,
    };

    // 10. Save all entities
    context.Pair.set(pair);
    context.Swap.set(swap);

    // 11. Update daily/hourly data
    if (bundle) {
      await updatePairDayData(pair, event, context, String(chainId));
      await updatePairHourData(pair, event, context, String(chainId));
      await updateUniswapDayData(event, context, String(chainId));
      await updateTokenDayData(finalToken0 || updatedToken0, event, context, String(chainId));
      await updateTokenDayData(finalToken1 || updatedToken1, event, context, String(chainId));
    }

  } catch (error) {
    context.log.error(`Error in handleSwap: ${error}`);
  }
});

// Implement handleTransfer function
// Reference: original-subgraph/src/v2/mappings/core.ts - handleTransfer
Pair.Transfer.handler(async ({ event, context }) => {
  try {
    // ignore initial transfers for first adds
    if (event.params.to === ADDRESS_ZERO && event.params.value === BigInt(1000)) {
      return;
    }

    const chainId = event.chainId;
    const factoryAddress = getFactoryAddress(chainId);
    const factory = await context.UniswapFactory.get(`${chainId}-${factoryAddress}`);
    if (!factory) {
      return;
    }

    // user stats
    const from = event.params.from;
    await createUser(from, context);
    const to = event.params.to;
    await createUser(to, context);

    // get pair and load contract
    const pair = await context.Pair.get(`${chainId}-${event.srcAddress}`);
    if (!pair) {
      return;
    }

    // liquidity token amount being transferred
    const value = convertTokenToDecimal(event.params.value, BI_18);

    // get or create transaction
    let transaction = await context.Transaction.get(event.transaction.hash);
    if (!transaction) {
      transaction = {
        id: event.transaction.hash,
        blockNumber: BigInt(event.block.number),
        timestamp: BigInt(event.block.timestamp),
      };
      context.Transaction.set(transaction);
    }

    // mints
    // part of the erc-20 standard (which is also the pool), whenever you mint new tokens, the from address is 0x0..0
    // the pool is also the erc-20 that gets minted and transferred around
    if (from === ADDRESS_ZERO) {
      // update total supply
      const updatedPair: Pair_t = {
        ...pair,
        totalSupply: pair.totalSupply.plus(value),
      };
      context.Pair.set(updatedPair);

      // create new mint if no mints so far or if last one is done already
      // transfers and mints come in pairs, but there could be a case where that doesn't happen and it might break
      // this is to make sure all the mints are under the same transaction
      const mintId = `${chainId}-${event.transaction.hash}-${event.logIndex}`;
      let mint = await context.Mint.get(mintId);
      if (!mint) {
        mint = {
          id: mintId,
          transaction_id: `${chainId}-${event.transaction.hash}`,
          timestamp: BigInt(event.block.timestamp),
          pair_id: pair.id,
          to: to,
          liquidity: value,
          sender: undefined,
          amount0: undefined,
          amount1: undefined,
          logIndex: BigInt(event.logIndex),
          amountUSD: undefined,
          feeTo: undefined,
          feeLiquidity: undefined,
        };
        context.Mint.set(mint);
      }
    }

    // case where direct send first on ETH withdrawals
    // for every burn event, there is a transfer first from the LP to the pool (erc-20)
    // when you LP, you get an ERC-20 token which is the accounting token of the LP position
    // the thing that's actually getting transferred is the LP account token
    if (to === pair.id) {
      // update total supply
      const updatedPair: Pair_t = {
        ...pair,
        totalSupply: pair.totalSupply.minus(value),
      };
      context.Pair.set(updatedPair);
    }

  } catch (error) {
    context.log.error(`Error in handleTransfer: ${error}`);
  }
});

// Implement handleSync function
// Reference: original-subgraph/src/v2/mappings/core.ts - handleSync
Pair.Sync.handler(async ({ event, context }) => {
  try {
    // 1. Load Pair and UniswapFactory entities
    const chainId = event.chainId;
    const pairId = `${chainId}-${event.srcAddress}`;
    
    let pair = await context.Pair.get(pairId);
    if (!pair) {
      return;
    }

    const token0 = await context.Token.get(pair.token0_id);
    if (!token0) {
      return;
    }

    const token1 = await context.Token.get(pair.token1_id);
    if (!token1) {
      return;
    }

    const factoryAddress = getFactoryAddress(chainId);
    const factoryId = `${chainId}-${factoryAddress}`;
    const factory = await context.UniswapFactory.get(factoryId);
    if (!factory) {
      return;
    }

    // 2. Reset factory liquidity by subtracting only tracked liquidity
    const updatedFactory: UniswapFactory_t = {
      ...factory,
      totalLiquidityETH: factory.totalLiquidityETH.minus(pair.trackedReserveETH || ZERO_BD),
    };

    // 3. Reset token total liquidity amounts
    const updatedToken0: Token_t = {
      ...token0,
      totalLiquidity: token0.totalLiquidity.minus(pair.reserve0),
    };

    const updatedToken1: Token_t = {
      ...token1,
      totalLiquidity: token1.totalLiquidity.minus(pair.reserve1),
    };

    // 4. Update pair reserves from event parameters
    const reserve0 = convertTokenToDecimal(event.params.reserve0, BigInt(token0.decimals));
    const reserve1 = convertTokenToDecimal(event.params.reserve1, BigInt(token1.decimals));

    // 5. Update pair token prices
    const token0Price = reserve1.isGreaterThan(ZERO_BD) ? reserve0.div(reserve1) : ZERO_BD;
    const token1Price = reserve0.isGreaterThan(ZERO_BD) ? reserve1.div(reserve0) : ZERO_BD;

    // 6. Update ETH price now that reserves could have changed
    const bundleId = `${chainId}-1`;
    const bundle = await context.Bundle.get(bundleId);
    if (bundle) {
      const newEthPrice = await getEthPriceInUSD(context, chainId);
      const updatedBundle: Bundle_t = {
        ...bundle,
        ethPrice: newEthPrice,
      };

      // 7. Recalculate derivedETH for both tokens
      const token0DerivedETH = await findEthPerToken(updatedToken0, context, chainId);
      const token1DerivedETH = await findEthPerToken(updatedToken1, context, chainId);

      // 8. Update tokens with new derivedETH values
      const finalToken0: Token_t = {
        ...updatedToken0,
        derivedETH: token0DerivedETH,
      };

      const finalToken1: Token_t = {
        ...updatedToken1,
        derivedETH: token1DerivedETH,
      };

      // 9. Calculate derived values for pair
      const reserve0ETH = reserve0.times(token0DerivedETH);
      const reserve1ETH = reserve1.times(token1DerivedETH);
      const reserveETH = reserve0ETH.plus(reserve1ETH);

      // 10. Calculate USD value
      const reserveUSD = reserveETH.times(newEthPrice);

      // 11. Get tracked liquidity - will be 0 if neither is in whitelist
      let trackedLiquidityETH = ZERO_BD;
      if (newEthPrice.isGreaterThan(ZERO_BD)) {
        const trackedLiquidityUSD = await getTrackedLiquidityUSD(reserve0, reserve1, finalToken0, finalToken1, context, chainId);
        trackedLiquidityETH = trackedLiquidityUSD.div(newEthPrice);
      }

      // 12. Update pair with all calculated values
      const updatedPair: Pair_t = {
        ...pair,
        reserve0: reserve0,
        reserve1: reserve1,
        reserveETH: reserveETH,
        reserveUSD: reserveUSD,
        token0Price: token0Price,
        token1Price: token1Price,
        trackedReserveETH: trackedLiquidityETH,
      };

      // 13. Update factory with new liquidity totals
      const finalFactory: UniswapFactory_t = {
        ...updatedFactory,
        totalLiquidityETH: updatedFactory.totalLiquidityETH.plus(trackedLiquidityETH),
        totalLiquidityUSD: updatedFactory.totalLiquidityETH.plus(trackedLiquidityETH).times(newEthPrice),
      };

      // 14. Update tokens with new total liquidity amounts
      const finalToken0WithLiquidity: Token_t = {
        ...finalToken0,
        totalLiquidity: finalToken0.totalLiquidity.plus(reserve0),
      };

      const finalToken1WithLiquidity: Token_t = {
        ...finalToken1,
        totalLiquidity: finalToken1.totalLiquidity.plus(reserve1),
      };

      // 15. Save all entities
      context.Bundle.set(updatedBundle);
      context.Token.set(finalToken0WithLiquidity);
      context.Token.set(finalToken1WithLiquidity);
      context.Pair.set(updatedPair);
      context.UniswapFactory.set(finalFactory);
    }

  } catch (error) {
    context.log.error(`Error in handleSync: ${error}`);
  }
});
