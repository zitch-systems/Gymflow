export const DR_FORMAT: {
  version: number;
  encryption: string;
  kdf: string;
  salt: string;
  iv: string;
};

export function encryptArchive(input: string, output: string, passphrase: string): Promise<void>;
export function decryptArchive(input: string, output: string, passphrase: string): Promise<void>;
export function assertIsolatedRestore(input: {
  ack?: string;
  sourceHost?: string;
  targetHost?: string;
}): void;
export function assertRestoreTargetBinding(apiUrl: string, databaseUrl: string): void;
export function postgresEnv(connectionString: string, base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
