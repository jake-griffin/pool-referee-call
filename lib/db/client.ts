import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * DynamoDB DocumentClient singleton.
 *
 * Configured from environment variables:
 *   AWS_REGION            — AWS region (default: us-east-1)
 *   AWS_ACCESS_KEY_ID     — IAM access key (picked up automatically by SDK fromEnv)
 *   AWS_SECRET_ACCESS_KEY — IAM secret key (picked up automatically by SDK fromEnv)
 *   DYNAMODB_TABLE_NAME   — Table name (default: RefereeCallApp)
 *
 * Retry strategy: "standard" mode applies exponential backoff with jitter.
 * maxAttempts: 4 = 1 initial attempt + 3 retries, base delay ~100 ms.
 * Requirements: 2.1, 7.2
 */

let _client: DynamoDBDocumentClient | null = null;

export function getDocumentClient(): DynamoDBDocumentClient {
  if (!_client) {
    const ddbClient = new DynamoDBClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
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
