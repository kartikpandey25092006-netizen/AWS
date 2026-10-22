// This controls presentation only. The API independently verifies the Cognito
// access token and administrator group for every protected request.
export function hasAdministratorGroup(accessToken?: string): boolean {
  if (!accessToken) return false
  try {
    const encoded = accessToken.split('.')[1]
    if (!encoded) return false
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const payload: unknown = JSON.parse(window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')))
    if (typeof payload !== 'object' || payload === null || !('cognito:groups' in payload)) return false
    const groups = payload['cognito:groups']
    return Array.isArray(groups) ? groups.includes('store-admin') : groups === 'store-admin'
  } catch {
    return false
  }
}
