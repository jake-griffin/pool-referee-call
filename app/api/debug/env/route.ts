import { NextResponse } from 'next/server';

/**
 * Temporary debug endpoint to check if environment variables are available.
 * DELETE THIS AFTER DEBUGGING.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ADMIN_SECRET_SET: !!process.env.ADMIN_SECRET,
    ADMIN_SECRET_LENGTH: process.env.ADMIN_SECRET?.length ?? 0,
    DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME ?? '(not set)',
    APP_AWS_REGION: process.env.APP_AWS_REGION ?? '(not set)',
    AWS_REGION: process.env.AWS_REGION ?? '(not set)',
    APP_AWS_ACCESS_KEY_ID_SET: !!process.env.APP_AWS_ACCESS_KEY_ID,
    NODE_ENV: process.env.NODE_ENV,
  });
}
