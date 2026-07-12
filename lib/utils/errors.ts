/**
 * Extracts a user-friendly error message from a failed API response.
 * Reads the JSON body `message` field if available, otherwise returns a generic message.
 * Never exposes raw error objects or stack traces.
 */
export async function extractUserMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body && typeof body.message === 'string' && body.message) {
      return body.message;
    }
  } catch {
    // Body is not JSON or empty
  }
  return 'Something went wrong. Please try again.';
}
