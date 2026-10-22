import "server-only";

import { Client } from "ldapts";

const LDAP_TIMEOUT_MS = 8_000;

export class LdapUnavailableError extends Error {
  constructor(cause: unknown) {
    super("No se pudo contactar con el servicio de autenticación.");
    this.name = "LdapUnavailableError";
    this.cause = cause;
  }
}

type LdapConfig = {
  url: string;
  serviceAccountUpn: string;
  serviceAccountPassword: string;
  baseSearchGroup: string;
  allowedGroupDn?: string;
};

let ldapConfig: LdapConfig | undefined;

export type LdapIdentity = {
  dn: string;
  email: string;
  name: string;
};

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required to authenticate against Active Directory.`);
  }

  return value;
}

function getLdapConfig(): LdapConfig {
  if (ldapConfig) {
    return ldapConfig;
  }

  const url = requiredEnvironment("INTEGRATION_LDAP_URL");
  const parsedUrl = new URL(url);

  if (parsedUrl.protocol !== "ldap:") {
    throw new Error("INTEGRATION_LDAP_URL must use ldap://.");
  }

  ldapConfig = {
    url,
    serviceAccountUpn: requiredEnvironment("INTEGRATION_LDAP_ACCESSACCOUNT_UPN"),
    serviceAccountPassword: requiredEnvironment("INTEGRATION_LDAP_ACCESSACCOUNT_PWD"),
    baseSearchGroup: requiredEnvironment("INTEGRATION_LDAP_USER_BASESEARCHGROUP"),
    allowedGroupDn: process.env.INTEGRATION_LDAP_ALLOWED_GROUP_DN?.trim() || undefined,
  };

  return ldapConfig;
}

function createClient(config: LdapConfig) {
  return new Client({
    url: config.url,
    connectTimeout: LDAP_TIMEOUT_MS,
    timeout: LDAP_TIMEOUT_MS,
  });
}

export function escapeLdapFilter(value: string) {
  return value.replace(/[\\*()\0]/g, (character) => {
    const escaped: Record<string, string> = {
      "\\": "\\5c",
      "*": "\\2a",
      "(": "\\28",
      ")": "\\29",
      "\0": "\\00",
    };

    return escaped[character];
  });
}

function entryValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0 ? String(value[0]) : "";
  }

  return value == null ? "" : String(value);
}

export async function findLdapIdentity(email: string): Promise<LdapIdentity | null> {
  const config = getLdapConfig();
  const client = createClient(config);

  try {
    await client.bind(config.serviceAccountUpn, config.serviceAccountPassword);
    const escapedEmail = escapeLdapFilter(email);
    const groupFilter = config.allowedGroupDn
      ? `(memberOf:1.2.840.113556.1.4.1941:=${escapeLdapFilter(config.allowedGroupDn)})`
      : "";
    const { searchEntries } = await client.search(config.baseSearchGroup, {
      scope: "sub",
      filter: `(&(|(mail=${escapedEmail})(userPrincipalName=${escapedEmail}))(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2))${groupFilter})`,
      attributes: ["displayName", "mail", "userPrincipalName"],
      sizeLimit: 2,
    });

    if (searchEntries.length !== 1) {
      return null;
    }

    const entry = searchEntries[0];
    const resolvedEmail = entryValue(entry.mail) || entryValue(entry.userPrincipalName) || email;
    const name = entryValue(entry.displayName) || resolvedEmail.split("@")[0];

    return {
      dn: String(entry.dn),
      email: resolvedEmail.trim().toLowerCase(),
      name: name.trim(),
    };
  } catch (error) {
    throw new LdapUnavailableError(error);
  } finally {
    await client.unbind().catch(() => undefined);
  }
}

export async function verifyLdapPassword(dn: string, password: string) {
  const config = getLdapConfig();
  const client = createClient(config);

  try {
    await client.bind(dn, password);
    return true;
  } catch (error) {
    if (isAuthenticationRejection(error)) {
      return false;
    }

    throw new LdapUnavailableError(error);
  } finally {
    await client.unbind().catch(() => undefined);
  }
}

function isAuthenticationRejection(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /data (525|52e|530|531|532|533|701|773|775)|InvalidCredentialsError/i.test(message);
}
