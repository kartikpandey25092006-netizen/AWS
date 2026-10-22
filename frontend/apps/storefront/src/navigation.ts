const configuredCloudOpsUrl = import.meta.env.VITE_CLOUDOPS_URL || (import.meta.env.PROD ? '' : 'http://localhost:5174/')

// Only a navigation intent crosses origins. Cognito issues the dashboard's own
// tokens through authorization code + PKCE; no credentials go in this link.
const dashboardUrl = configuredCloudOpsUrl ? new URL(configuredCloudOpsUrl, window.location.origin) : null
dashboardUrl?.searchParams.set('sso', 'storefront')
export const cloudOpsUrl = dashboardUrl?.href
