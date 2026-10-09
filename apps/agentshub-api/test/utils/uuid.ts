import { randomUUID } from 'crypto';

// uuid 14 ships only ES modules, which Jest's CommonJS runtime can't load. Jest maps 'uuid' to this file
// (moduleNameMapper); the code only uses v4() for upload file names (libs/config.ts getSerialForImage)
export const v4 = (): string => randomUUID();
