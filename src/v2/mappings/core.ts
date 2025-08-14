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
import { ADDRESS_ZERO, ZERO_BD, ZERO_BI, ONE_BI, BI_18, FACTORY_ADDRESS, ALMOST_ZERO_BD } from "../../common/constants";
import { BigDecimal } from "generated";
import { convertTokenToDecimal, createUser } from "../../common/helpers";
import { getTrackedVolumeUSD, getEthPriceInUSD, findEthPerToken, getTrackedLiquidityUSD } from "../../common/pricing";
import { updatePairDayData, updatePairHourData, updateUniswapDayData, updateTokenDayData, updateTokenHourData } from "../../common/hourDayUpdates";

// Implement handleMint function
// Reference: original-subgraph/src/v2/mappings/core.ts - handleMint
Pair.Mint.handler(async ({ event, context }) => {
  try {
    // 1. Load Transaction entity (created by handleTransfer)
    const transactionId = event.transaction.hash;
    const transaction = await context.Transaction.get(transactionId);
    if (!transaction) {
      context.log.error(`Transaction not found for mint: ${transactionId}`);
      return;
    }

    // 2. Load MintEvent entity using indexed field operations
    // In Envio, @derivedFrom arrays are virtual fields that don't exist in handlers
    // Instead, we query for Mints using their indexed transaction_id field
    // The Mint entity should have been created by the Transfer handler
    const mintId = `${transactionId}-${event.logIndex}`;
    let mint = await context.Mint.get(mintId);
    if (!mint) {
      context.log.error(`Mint entity not found: ${mintId}. This suggests the Transfer handler didn't create it properly.`);
      return;
    }

    // 3. Load Pair and UniswapFactory entities
    const pair = await context.Pair.get(event.srcAddress);
    if (!pair) {
      context.log.error(`Pair not found for mint: ${event.srcAddress}`);
      return;
    }

    const factory = await context.UniswapFactory.get(FACTORY_ADDRESS);
    if (!factory) {
      context.log.error(`Factory not found for mint`);
      return;
    }

    // 4. Load Token entities for token0 and token1
    const token0 = await context.Token.get(pair.token0_id);
    const token1 = await context.Token.get(pair.token1_id);
    if (!token0 || !token1) {
      context.log.error(`Token not found for mint: token0=${pair.token0_id}, token1=${pair.token1_id}`);
      return;
    }

    // 5. Convert event amounts using convertTokenToDecimal
    const token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals);

    // 6. Update token transaction counts
    const updatedToken0: Token_t = { ...token0, txCount: token0.txCount + ONE_BI };
    const updatedToken1: Token_t = { ...token1, txCount: token1.txCount + ONE_BI };

    // 7. Calculate USD amounts using pricing functions
    const bundle = await context.Bundle.get('1');
    let amountTotalUSD = ZERO_BD;
    if (bundle && bundle.ethPrice) {
      // Simplified USD calculation: (token0.derivedETH * amount0 + token1.derivedETH * amount1) * ethPrice
      const token0USD = token0.derivedETH.times(token0Amount).times(bundle.ethPrice);
      const token1USD = token1.derivedETH.times(token1Amount).times(bundle.ethPrice);
      amountTotalUSD = token0USD.plus(token1USD);
    }

    // 8. Update pair and global statistics
    const updatedPair: Pair_t = { ...pair, txCount: pair.txCount + ONE_BI };
    const updatedFactory: UniswapFactory_t = { ...factory, txCount: factory.txCount + ONE_BI };

    // Update mint entity with calculated values
    const updatedMint: Mint_t = {
      ...mint,
      amount0: token0Amount,
      amount1: token1Amount,
      amountUSD: amountTotalUSD,
    };

    // 9. Save all entities
    context.Token.set(updatedToken0);
    context.Token.set(updatedToken1);
    context.Pair.set(updatedPair);
    context.UniswapFactory.set(updatedFactory);
    context.Mint.set(updatedMint);

    // Update day entities using hourDayUpdates helpers
    updatePairDayData(pair, event, context);
    updatePairHourData(pair, event, context);
    updateUniswapDayData(event, context);
    updateTokenDayData(token0, event, context);
    updateTokenDayData(token1, event, context);

    context.log.info(`Processed mint: ${token0Amount} ${token0.symbol} + ${token1Amount} ${token1.symbol} for pair ${event.srcAddress}`);

  } catch (error) {
    context.log.error(`Error in handleMint: ${error}`);
  }
});

// Burn event handler - processes liquidity removal events
Pair.Burn.handler(async ({ event, context }) => {
  try {
    // 1. Load Transaction entity (created by handleTransfer)
    const transactionId = event.transaction.hash;
    const transaction = await context.Transaction.get(transactionId);
    if (!transaction) {
      context.log.error(`Transaction not found for burn: ${transactionId}`);
      return;
    }

    // 2. Load Burn entity (created by Transfer handler)
    // In Envio, we need to find the Burn entity by looking at the transaction
    // Since we can't access arrays directly, we'll use the same ID pattern as Mint
    const burnId = `${transactionId}-${event.logIndex}`;
    let burn = await context.Burn.get(burnId);
    if (!burn) {
      context.log.error(`Burn entity not found: ${burnId}. This suggests the Transfer handler didn't create it properly.`);
      return;
    }

    // 3. Load Pair and UniswapFactory entities
    const pair = await context.Pair.get(event.srcAddress);
    if (!pair) {
      context.log.error(`Pair not found for burn: ${event.srcAddress}`);
      return;
    }

    const factory = await context.UniswapFactory.get(FACTORY_ADDRESS);
    if (!factory) {
      context.log.error(`Factory not found for burn`);
      return;
    }

    // 4. Load Token entities for token0 and token1
    const token0 = await context.Token.get(pair.token0_id);
    const token1 = await context.Token.get(pair.token1_id);
    if (!token0 || !token1) {
      context.log.error(`Token not found for burn: token0=${pair.token0_id}, token1=${pair.token1_id}`);
      return;
    }

    // 5. Convert event amounts using convertTokenToDecimal
    const token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals);

    // 6. Calculate USD amounts using pricing functions
    const bundle = await context.Bundle.get('1');
    let amountTotalUSD = ZERO_BD;
    if (bundle && bundle.ethPrice) {
      // Simplified USD calculation: (token0.derivedETH * amount0 + token1.derivedETH * amount1) * ethPrice
      const token0USD = token0.derivedETH.times(token0Amount).times(bundle.ethPrice);
      const token1USD = token1.derivedETH.times(token1Amount).times(bundle.ethPrice);
      amountTotalUSD = token0USD.plus(token1USD);
    }

    // 7. Update token transaction counts
    const updatedToken0: Token_t = { ...token0, txCount: token0.txCount + ONE_BI };
    const updatedToken1: Token_t = { ...token1, txCount: token1.txCount + ONE_BI };

    // 8. Update pair and global statistics
    const updatedPair: Pair_t = { ...pair, txCount: pair.txCount + ONE_BI };
    const updatedFactory: UniswapFactory_t = { ...factory, txCount: factory.txCount + ONE_BI };

    // 9. Update burn entity with calculated values
    const updatedBurn: Burn_t = {
      ...burn,
      sender: event.params.sender,
      amount0: token0Amount,
      amount1: token1Amount,
      amountUSD: amountTotalUSD,
      logIndex: BigInt(event.logIndex),
    };

    // 10. Save all entities
    context.Token.set(updatedToken0);
    context.Token.set(updatedToken1);
    context.Pair.set(updatedPair);
    context.UniswapFactory.set(updatedFactory);
    context.Burn.set(updatedBurn);

    // Update day entities using hourDayUpdates helpers
    updatePairDayData(pair, event, context);
    updatePairHourData(pair, event, context);
    updateUniswapDayData(event, context);
    updateTokenDayData(token0, event, context);
    updateTokenDayData(token1, event, context);

    context.log.info(`Processed burn: ${token0Amount} ${token0.symbol} + ${token1Amount} ${token1.symbol} for pair ${event.srcAddress}`);

  } catch (error) {
    context.log.error(`Error in handleBurn: ${error}`);
  }
});

// Swap event handler - processes token exchange events
Pair.Swap.handler(async ({ event, context }) => {
  try {
    // 1. Load Pair and UniswapFactory entities
    const pair = await context.Pair.get(event.srcAddress);
    if (!pair) {
      context.log.error(`Pair not found for swap: ${event.srcAddress}`);
      return;
    }

    const factory = await context.UniswapFactory.get(FACTORY_ADDRESS);
    if (!factory) {
      context.log.error(`Factory not found for swap`);
      return;
    }

    // 2. Load Token entities for token0 and token1
    const token0 = await context.Token.get(pair.token0_id);
    const token1 = await context.Token.get(pair.token1_id);
    if (!token0 || !token1) {
      context.log.error(`Token not found for swap: token0=${pair.token0_id}, token1=${pair.token1_id}`);
      return;
    }

    // 3. Convert event amounts using convertTokenToDecimal
    const amount0In = convertTokenToDecimal(event.params.amount0In, token0.decimals);
    const amount1In = convertTokenToDecimal(event.params.amount1In, token1.decimals);
    const amount0Out = convertTokenToDecimal(event.params.amount0Out, token0.decimals);
    const amount1Out = convertTokenToDecimal(event.params.amount0Out, token1.decimals);

    // 4. Calculate totals for volume updates
    const amount0Total = amount0Out.plus(amount1In);
    const amount1Total = amount1Out.plus(amount1In);

    // 5. Load Bundle for ETH/USD prices
    const bundle = await context.Bundle.get('1');
    if (!bundle) {
      context.log.error(`Bundle not found for swap`);
      return;
    }

    // 6. Calculate derived amounts for tracking
    const derivedEthToken1 = token1.derivedETH.times(amount1Total);
    const derivedEthToken0 = token0.derivedETH.times(amount0Total);

    let derivedAmountETH = ZERO_BD;
    // If any side is 0, do not divide by 2
    if (derivedEthToken0.isLessThanOrEqualTo(ALMOST_ZERO_BD) || derivedEthToken1.isLessThanOrEqualTo(ALMOST_ZERO_BD)) {
      derivedAmountETH = derivedEthToken0.plus(derivedEthToken1);
    } else {
      derivedAmountETH = derivedEthToken0.plus(derivedEthToken1).div(new BigDecimal(2));
    }

    const derivedAmountUSD = derivedAmountETH.times(bundle.ethPrice);

    // 7. Calculate tracked volume using real pricing logic
    const trackedAmountUSD = getTrackedVolumeUSD(
      amount0Total,
      token0,
      amount1Total,
      token1,
      pair,
      context
    );
    
    let trackedAmountETH = ZERO_BD;
    if (bundle.ethPrice.isGreaterThan(ZERO_BD)) {
      trackedAmountETH = trackedAmountUSD.div(bundle.ethPrice);
    }

    // 8. Update token0 global volume and token liquidity stats
    const updatedToken0: Token_t = {
      ...token0,
      tradeVolume: token0.tradeVolume.plus(amount0In.plus(amount0Out)),
      tradeVolumeUSD: token0.tradeVolumeUSD.plus(trackedAmountUSD),
      untrackedVolumeUSD: token0.untrackedVolumeUSD.plus(derivedAmountUSD),
      txCount: token0.txCount + ONE_BI,
    };

    // 9. Update token1 global volume and token liquidity stats
    const updatedToken1: Token_t = {
      ...token1,
      tradeVolume: token1.tradeVolume.plus(amount1In.plus(amount1Out)),
      tradeVolumeUSD: token1.tradeVolumeUSD.plus(trackedAmountUSD),
      untrackedVolumeUSD: token1.untrackedVolumeUSD.plus(derivedAmountUSD),
      txCount: token1.txCount + ONE_BI,
    };

    // 10. Update pair volume data
    const updatedPair: Pair_t = {
      ...pair,
      volumeUSD: pair.volumeUSD.plus(trackedAmountUSD),
      volumeToken0: pair.volumeToken0.plus(amount0Total),
      volumeToken1: pair.volumeToken1.plus(amount1Total),
      untrackedVolumeUSD: pair.untrackedVolumeUSD.plus(derivedAmountUSD),
      txCount: pair.txCount + ONE_BI,
    };

    // 11. Update global values
    const updatedFactory: UniswapFactory_t = {
      ...factory,
      totalVolumeUSD: factory.totalVolumeUSD.plus(trackedAmountUSD),
      totalVolumeETH: factory.totalVolumeETH.plus(trackedAmountETH),
      untrackedVolumeUSD: factory.untrackedVolumeUSD.plus(derivedAmountUSD),
      txCount: factory.txCount + ONE_BI,
    };

    // 12. Create Swap entity
    const swapId = `${event.transaction.hash}-${event.logIndex}`;
    const swap: Swap_t = {
      id: swapId,
      transaction_id: event.transaction.hash,
      timestamp: BigInt(event.block.timestamp),
      pair_id: event.srcAddress,
      sender: event.params.sender,
      from: event.params.sender, // Use sender as from since we don't have transaction.from
      amount0In: amount0In,
      amount1In: amount1In,
      amount0Out: amount0Out,
      amount1Out: amount1Out,
      to: event.params.to,
      logIndex: BigInt(event.logIndex),
      amountUSD: trackedAmountUSD.isGreaterThan(ZERO_BD) ? trackedAmountUSD : derivedAmountUSD,
    };

    // 13. Save all entities
    context.Token.set(updatedToken0);
    context.Token.set(updatedToken1);
    context.Pair.set(updatedPair);
    context.UniswapFactory.set(updatedFactory);
    context.Swap.set(swap);

    // Update day entities using hourDayUpdates helpers
    updatePairDayData(pair, event, context);
    updatePairHourData(pair, event, context);
    updateUniswapDayData(event, context);
    updateTokenDayData(token0, event, context);
    updateTokenDayData(token1, event, context);

    context.log.info(`Processed swap: ${amount0In} ${token0.symbol} + ${amount1In} ${token1.symbol} -> ${amount0Out} ${token0.symbol} + ${amount1Out} ${token1.symbol} for pair ${event.srcAddress}`);

  } catch (error) {
    context.log.error(`Error in handleSwap: ${error}`);
  }
});

// Transfer event handler - processes LP token transfers and creates Mint/Burn entities
Pair.Transfer.handler(async ({ event, context }) => {
  try {
    // 1. Skip initial transfers for first adds
    if (event.params.to === ADDRESS_ZERO && event.params.value === BigInt(1000)) {
      return;
    }

    // 2. Load UniswapFactory entity
    const factory = await context.UniswapFactory.get(FACTORY_ADDRESS);
    if (!factory) {
      context.log.error('Factory not found in handleTransfer');
      return;
    }

    // 3. Create User entities for from and to addresses
    createUser(event.params.from, context);
    createUser(event.params.to, context);

    // 4. Load Pair entity
    const pair = await context.Pair.get(event.srcAddress);
    if (!pair) {
      context.log.error(`Pair not found: ${event.srcAddress}`);
      return;
    }

    // 5. Convert transfer value using convertTokenToDecimal
    const value = convertTokenToDecimal(event.params.value, BI_18);

    // 6. Load/Create Transaction entity
    const transactionId = event.transaction.hash;
    let transaction = await context.Transaction.get(transactionId);
    if (!transaction) {
      transaction = {
        id: transactionId,
        blockNumber: BigInt(event.block.number),
        timestamp: BigInt(event.block.timestamp),
        // Note: @derivedFrom arrays are virtual fields in Envio, not actual array properties
        // They're populated automatically when querying the API, not in handlers
      };
      context.Transaction.set(transaction);
    }

    // 7. Handle mint logic (from == ADDRESS_ZERO)
    if (event.params.from === ADDRESS_ZERO) {
      // Update pair totalSupply
      const updatedPair: Pair_t = {
        ...pair,
        totalSupply: pair.totalSupply.plus(value),
      };
      context.Pair.set(updatedPair);

      // Create Mint entity (following original subgraph logic)
      const mintId = `${transactionId}-${event.logIndex}`;
      const mint: Mint_t = {
        id: mintId,
        transaction_id: transactionId,
        timestamp: BigInt(event.block.timestamp),
        pair_id: event.srcAddress,
        to: event.params.to,
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

      // Note: In Envio, @derivedFrom arrays are virtual fields populated automatically
      // We don't need to manually update transaction.mints - the relationship is
      // established by setting mint.transaction_id = transactionId
    }

    // 8. Handle burn logic (to == pair.id)
    if (event.params.to === pair.id) {
      // TODO: Create BurnEvent entity when we add it to schema
      // TODO: Update transaction.burns array when we add it to schema
    }

    // 9. Handle burn completion (to == ADDRESS_ZERO && from == pair.id)
    if (event.params.to === ADDRESS_ZERO && event.params.from === pair.id) {
      // Update pair totalSupply
      const updatedPair: Pair_t = {
        ...pair,
        totalSupply: pair.totalSupply.minus(value),
      };
      context.Pair.set(updatedPair);

      // TODO: Update transaction.burns array when we add it to schema
    }

    context.log.info(`Processed transfer: ${event.params.value} from ${event.params.from} to ${event.params.to} for pair ${event.srcAddress}`);

  } catch (error) {
    context.log.error(`Error in handleTransfer: ${error}`);
  }
});

// Sync event handler - updates reserves and recalculates prices
Pair.Sync.handler(async ({ event, context }) => {
  try {
    // 1. Load Pair and Token entities
    const pair = await context.Pair.get(event.srcAddress);
    if (!pair) {
      context.log.error(`Pair not found for sync event: ${event.srcAddress}`);
      return;
    }

    const token0 = await context.Token.get(pair.token0_id);
    const token1 = await context.Token.get(pair.token1_id);
    if (!token0 || !token1) {
      context.log.error(`Token not found for sync event: ${event.srcAddress}`);
      return;
    }

    const factory = await context.UniswapFactory.get(FACTORY_ADDRESS);
    if (!factory) {
      context.log.error(`Factory not found for sync event: ${event.srcAddress}`);
      return;
    }

    // 2. Reset factory liquidity by subtracting only tracked liquidity
    const updatedFactory: UniswapFactory_t = {
      ...factory,
      totalLiquidityETH: factory.totalLiquidityETH.minus(pair.trackedReserveETH)
    };

    // 3. Reset token total liquidity amounts
    const updatedToken0: Token_t = {
      ...token0,
      totalLiquidity: token0.totalLiquidity.minus(pair.reserve0)
    };
    const updatedToken1: Token_t = {
      ...token1,
      totalLiquidity: token1.totalLiquidity.minus(pair.reserve1)
    };

    // 4. Update pair reserves and calculate new prices
    const newReserve0 = convertTokenToDecimal(event.params.reserve0, token0.decimals);
    const newReserve1 = convertTokenToDecimal(event.params.reserve1, token1.decimals);

    let newToken0Price = ZERO_BD;
    let newToken1Price = ZERO_BD;

    if (!newReserve1.isEqualTo(ZERO_BD)) {
      newToken0Price = newReserve0.div(newReserve1);
    }
    if (!newReserve0.isEqualTo(ZERO_BD)) {
      newToken1Price = newReserve1.div(newReserve0);
    }

    // 5. Update ETH price now that reserves could have changed
    const bundle = await context.Bundle.get('1');
    if (!bundle) {
      context.log.error(`Bundle not found for sync event: ${event.srcAddress}`);
      return;
    }

    const newEthPrice = getEthPriceInUSD(context);
    const updatedBundle: Bundle_t = {
      ...bundle,
      ethPrice: newEthPrice
    };

    // 6. Update token derived ETH values
    const token0DerivedETH = findEthPerToken(token0, context);
    const token1DerivedETH = findEthPerToken(token1, context);

    const finalToken0: Token_t = {
      ...updatedToken0,
      derivedETH: token0DerivedETH
    };
    const finalToken1: Token_t = {
      ...updatedToken0,
      derivedETH: token1DerivedETH
    };

    // 7. Calculate tracked liquidity ETH
    let trackedLiquidityETH = ZERO_BD;
    if (!newEthPrice.isEqualTo(ZERO_BD)) {
      const trackedLiquidityUSD = getTrackedLiquidityUSD(newReserve0, finalToken0, newReserve1, finalToken1, context);
      trackedLiquidityETH = trackedLiquidityUSD.div(newEthPrice);
    }

    // 8. Update pair with new reserves and prices
    const updatedPair: Pair_t = {
      ...pair,
      reserve0: newReserve0,
      reserve1: newReserve1,
      token0Price: newToken0Price,
      token1Price: newToken1Price,
      trackedReserveETH: trackedLiquidityETH,
      reserveETH: newReserve0.times(token0DerivedETH).plus(newReserve1.times(token1DerivedETH)),
      reserveUSD: newReserve0.times(token0DerivedETH).plus(newReserve1.times(token1DerivedETH)).times(newEthPrice)
    };

    // 9. Update global liquidity amounts
    const finalFactory: UniswapFactory_t = {
      ...updatedFactory,
      totalLiquidityETH: updatedFactory.totalLiquidityETH.plus(trackedLiquidityETH),
      totalLiquidityUSD: updatedFactory.totalLiquidityETH.plus(trackedLiquidityETH).times(newEthPrice)
    };

    // 10. Now correctly set liquidity amounts for each token
    const finalToken0WithLiquidity: Token_t = {
      ...finalToken0,
      totalLiquidity: finalToken0.totalLiquidity.plus(newReserve0)
    };
    const finalToken1WithLiquidity: Token_t = {
      ...finalToken1,
      totalLiquidity: finalToken1.totalLiquidity.plus(newReserve1)
    };

    // 11. Save all entities
    context.Pair.set(updatedPair);
    context.UniswapFactory.set(finalFactory);
    context.Token.set(finalToken0WithLiquidity);
    context.Token.set(finalToken1WithLiquidity);
    context.Bundle.set(updatedBundle);

    context.log.info(`Sync processed for pair ${event.srcAddress} - new reserves: ${newReserve0}, ${newReserve1}`);
  } catch (error) {
    context.log.error(`Error in handleSync: ${error}`);
  }
});
