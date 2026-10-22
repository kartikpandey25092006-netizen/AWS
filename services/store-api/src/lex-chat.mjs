const FALLBACK_MESSAGE = 'I can help with products, sign-in help, or where to view your orders.'

export function createLexChatResponder({ botId, botAliasId, localeId = 'en_US', region = process.env.AWS_REGION || 'us-east-1' } = {}) {
  if (!botId || !botAliasId) return null

  let client
  let sdkPromise
  return async ({ message, sessionId }) => {
    if (!sdkPromise) sdkPromise = import('@aws-sdk/client-lex-runtime-v2')
    const { LexRuntimeV2Client, RecognizeTextCommand } = await sdkPromise
    client ||= new LexRuntimeV2Client({ region, maxAttempts: 2 })
    const result = await client.send(new RecognizeTextCommand({
      botId,
      botAliasId,
      localeId,
      sessionId,
      text: message,
    }))
    const messages = (result.messages || [])
      .filter((item) => item.contentType === 'PlainText' && typeof item.content === 'string')
      .map((item) => item.content.trim())
      .filter(Boolean)
    return messages.length ? messages.slice(0, 5) : [FALLBACK_MESSAGE]
  }
}
