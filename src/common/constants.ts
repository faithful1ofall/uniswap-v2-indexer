// Constants from original subgraph helpers
// Reference: original-subgraph/src/common/constants.ts

import { BigDecimal } from "generated";

export const ZERO_BI = BigInt(0);
export const ONE_BI = BigInt(1);
export const ZERO_BD = new BigDecimal(0);
export const ONE_BD = new BigDecimal(1);

// Additional constants from original subgraph
export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';
export const BI_18 = BigInt(18);
export const ALMOST_ZERO_BD = new BigDecimal('0.000001');

// TODO: FACTORY_ADDRESS should come from chain.ts or environment
// For now, using Ethereum mainnet factory address
export const FACTORY_ADDRESS = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
