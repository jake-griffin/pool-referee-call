import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * DynamoDB DocumentClient singleton.
 *
 * Configured from environment variables:
 *   APP_AWS_REGION            — AWS region (default: us-east-1). Falls back to AWS_REGION.
 *   APP_AWS_ACCESS_KEY_ID     — IAM access key. Falls back to AWS_ACCESS_KEY_ID.
 *   APP_AWS_SECRET_ACCESS_KEY — IAM secret key. Falls back to AWS_SECRET_ACCESS_KEY.
 *   DYNAMODB_TABLE_NAME       — Table name (default: RefereeCallApp)
 *
 * The APP_ prefixed versions exist because AWS Amplify reserves the AWS_ prefix
 * for env vars. Locally you can use either prefix.
 *
 * Retry strategy: "standard" mode applies exponential backoff with jitter.
 * maxAttempts: 4 = 1 initial attempt + 3 retries, base delay ~100 ms.
 * Requirements: 2.1, 7.2
 */

let _client: DynamoDBDocumentClient | null = null;

export function getDocumentClient(): DynamoDBDocumentClient {
  if (!_client) {
    const region = process.env.APP_AWS_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
    const accessKeyId = process.env.APP_AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.APP_AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;

    const credentials = accessKeyId && secretAccessKey
      ? { accessKeyId, secretAccessKey }
      : undefined; // Let SDK use default credential chain (IAM role, etc.)

    const ddbClient = new DynamoDBClient({
      region,
      ...(credentials && { credentials }),
      // "standard" retry mode: exponential backoff, base ~100 ms, jitter applied.
      retryMode: 'standard',
      maxAttempts: 4, // 1 initial + 3 retries
    });

    _client = DynamoDBDocumentClient.from(ddbClient, {
      marshallOptions: {
        // Drop undefined fields so optional attributes don't pollute items.
        removeUndefinedValues: true,
        convertEmptyValues: false,
      },
      unmarshallOptions: {
        // Return numbers as JS number (not BigInt).
        wrapNumbers: false,
      },
    });
  }
  return _client;
}

/** DynamoDB table name, read from the environment at startup. */
export const TABLE_NAME =
  process.env.DYNAMODB_TABLE_NAME ?? 'RefereeCallApp';

/** GSI name as defined in the data model for unanswered / per-referee queues. */
export const GSI1_NAME = 'GSI1';
