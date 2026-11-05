// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OAuth / auth discovery stubs for ChatGPT Apps SDK plugin submission.
 *
 * MVP auth is Bearer (AINOBI access_token or org Agent `ainobi_ak_*`). Public directory listing typically
 * requires a full OAuth authorization-server + protected-resource pairing against
 * the education backend — document the intended endpoints here.
 */

export type OAuthProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
  resource_documentation?: string;
};

/** RFC 9728-style protected resource metadata for `/mcp`. */
export function buildOAuthProtectedResourceMetadata(args: {
  publicBaseUrl: string;
  authorizationServer?: string;
}): OAuthProtectedResourceMetadata {
  const resource = `${args.publicBaseUrl.replace(/\/$/, '')}/mcp`;
  const authServer =
    args.authorizationServer?.trim() ||
    process.env.AINOBI_BACKEND_API_BASE?.trim() ||
    args.publicBaseUrl;
  return {
    resource,
    authorization_servers: [authServer.replace(/\/$/, '')],
    scopes_supported: ['ainobi.courseware.write', 'ainobi.courseware.read'],
    bearer_methods_supported: ['header'],
    resource_documentation: `${args.publicBaseUrl.replace(/\/$/, '')}/docs/CODEX_PLUGIN.md`,
  };
}
