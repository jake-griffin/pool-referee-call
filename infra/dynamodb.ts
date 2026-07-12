// Optional CDK stack for provisioning the RefereeCallApp DynamoDB table.
// Can be deployed with: npx cdk deploy
// Alternatively, create the table manually in the AWS Console.

import { Stack, StackProps, App, RemovalPolicy } from 'aws-cdk-lib';
import {
  Table,
  AttributeType,
  BillingMode,
  ProjectionType,
} from 'aws-cdk-lib/aws-dynamodb';

export class RefereeCallAppStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);

    const table = new Table(this, 'RefereeCallAppTable', {
      tableName: 'RefereeCallApp',
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
  }
}

// Instantiate the stack when run directly
const app = new App();
new RefereeCallAppStack(app, 'RefereeCallAppStack');
