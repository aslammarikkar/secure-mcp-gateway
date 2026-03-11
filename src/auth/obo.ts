import { ManagedIdentityCredential, OnBehalfOfCredential } from "@azure/identity";
import { decodeJwt } from "jose";
import { getOboConfig } from "../config/auth-config.js";

let managedIdentityCredential: ManagedIdentityCredential | undefined;

function getManagedIdentityCredential(): ManagedIdentityCredential {
  // The managed identity is process-wide infrastructure, so we create it once and
  // reuse it across requests instead of rebuilding the credential every time.
  if (!managedIdentityCredential) {
    const oboConfig = getOboConfig();
    managedIdentityCredential = new ManagedIdentityCredential(
      oboConfig.managedIdentityClientId,
      {
        retryOptions: {
          maxRetries: 3,
          retryDelayInMs: 500,
          maxRetryDelayInMs: 5000,
        },
      }
    );
  }

  return managedIdentityCredential;
}

function validateAssertionTokenExpiry(userAssertionToken: string, bufferSeconds = 300): void {
  const payload = decodeJwt(userAssertionToken);
  const expiresAt = typeof payload.exp === "number" ? payload.exp : undefined;

  if (!expiresAt) {
    return;
  }

  const secondsRemaining = expiresAt - Math.floor(Date.now() / 1000);
  if (secondsRemaining < bufferSeconds) {
    throw new Error("Token expiring soon, please re-authenticate");
  }
}

async function getManagedIdentityAssertion(): Promise<string> {
  const oboConfig = getOboConfig();
  // This token is the federated assertion that allows the app registration to
  // exchange the incoming user token without storing a client secret.
  const accessToken = await getManagedIdentityCredential().getToken([
    oboConfig.tokenExchangeScope,
  ]);

  if (!accessToken?.token) {
    throw new Error("Failed to acquire managed identity assertion token");
  }

  return accessToken.token;
}

export async function getAccessTokenOnBehalfOf(
  userAssertionToken: string,
  scopes?: string[]
): Promise<string> {
  const oboConfig = getOboConfig();
  // Fail early when the incoming user token is nearly expired; otherwise the OBO
  // exchange can fail deeper in the Azure identity stack with less actionable errors.
  validateAssertionTokenExpiry(userAssertionToken);

  const credential = new OnBehalfOfCredential({
    tenantId: oboConfig.tenantId,
    clientId: oboConfig.clientId,
    getAssertion: getManagedIdentityAssertion,
    userAssertionToken,
  });

  const accessToken = await credential.getToken(scopes ?? [oboConfig.graphScope]);
  if (!accessToken?.token) {
    throw new Error("Failed to acquire OBO access token");
  }

  return accessToken.token;
}

export async function getGraphAccessTokenOnBehalfOf(
  userAssertionToken: string
): Promise<string> {
  return getAccessTokenOnBehalfOf(userAssertionToken);
}