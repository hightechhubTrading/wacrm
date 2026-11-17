import { readFile, stat } from 'node:fs/promises';
import { createPrivateKey } from 'node:crypto';

export interface PushConfig {
  projectId: string;
  appId: string;
  environment: 'development' | 'production';
  credentialsFile: string;
}
export function pushConfig(): PushConfig | null {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const appId = process.env.MOBILE_PUSH_APP_ID;
  const environment = process.env.MOBILE_PUSH_ENVIRONMENT;
  const credentialsFile = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
  if (
    !projectId ||
    !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId) ||
    !['com.hightechhub.crm.demo', 'com.hightechhub.crm'].includes(
      appId ?? ''
    ) ||
    !['development', 'production'].includes(environment ?? '') ||
    !credentialsFile?.startsWith('/')
  )
    return null;
  return {
    projectId,
    appId: appId!,
    environment: environment as PushConfig['environment'],
    credentialsFile,
  };
}
export async function pushCredentials(config: PushConfig) {
  const info = await stat(config.credentialsFile);
  if (!info.isFile() || info.size > 65536)
    throw new Error('Invalid push credentials');
  const bytes = await readFile(config.credentialsFile);
  if (bytes.length > 65536) throw new Error('Invalid push credentials');
  const value = JSON.parse(bytes.toString());
  if (
    value.type !== 'service_account' ||
    value.project_id !== config.projectId ||
    typeof value.client_email !== 'string' ||
    !/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.iam\.gserviceaccount\.com$/.test(
      value.client_email
    ) ||
    typeof value.private_key !== 'string' ||
    !value.private_key.includes('BEGIN PRIVATE KEY')
  )
    throw new Error('Invalid push credentials');
  const key = createPrivateKey(value.private_key);
  if (
    key.asymmetricKeyType !== 'rsa' ||
    (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
  )
    throw new Error('Invalid push credentials');
  return {
    email: value.client_email as string,
    privateKey: value.private_key as string,
  };
}
export async function activePushConfig(): Promise<PushConfig | null> {
  const config = pushConfig();
  if (!config) return null;
  try {
    await pushCredentials(config);
    return config;
  } catch {
    return null;
  }
}
