import { CognitoJwtVerifier } from 'aws-jwt-verify'

export function createCognitoAccessTokenVerifier({ userPoolId, clientId } = {}) {
  if (!userPoolId || !clientId) return null

  const verifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'access',
    clientId,
  })

  return (token) => verifier.verify(token)
}
