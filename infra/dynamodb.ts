// Optional CDK stack for provisioning the RefereeCallApp DynamoDB table.
// Can be deployed with: npx cdk deploy --app "npx ts-node --compiler-options '{\"module\":\"commonjs\"}' infra/dynamodb.ts"
// Alternatively, create the table manually in the AWS Console.

/* eslint-disable @typescript-eslint/no-require-imports */
const cdk = require('aws-cdk-lib');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');

class RefereeCallAppStack extends cdk.Stack {
  constructor(scope: any, id: string, props?: any) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'RefereeCallAppTable', {
      tableName: 'RefereeCallApp',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }
}

const app = new cdk.App();
new RefereeCallAppStack(app, 'RefereeCallAppStack');
