declare module 'intuit-oauth' {
  interface OAuthClientConfig {
    clientId: string;
    clientSecret: string;
    environment: string;
    redirectUri: string;
  }

  interface TokenData {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
    realmId?: string;
  }

  interface Token {
    getToken(): TokenData;
    isAccessTokenValid(): boolean;
    access_token: string;
    refresh_token: string;
    token_type: string;
    realmId?: string;
  }

  interface AuthResponse {
    getToken(): TokenData;
    getJson(): any;
    text(): string;
    token: Token;
    body: string;
    json: any;
    intuit_tid: string;
  }

  class OAuthClient {
    constructor(config: OAuthClientConfig);
    authorizeUri(params: { scope: string | string[]; state: string }): string;
    createToken(url: string): Promise<AuthResponse>;
    refresh(): Promise<AuthResponse>;
    refreshUsingToken(refreshToken: string): Promise<AuthResponse>;
    makeApiCall(params: { url: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<AuthResponse>;
    setToken(token: Partial<TokenData>): void;
    getToken(): Token;
    isAccessTokenValid(): boolean;
    environment: {
      sandbox: string;
      production: string;
    };
    scopes: {
      Accounting: string;
      Payment: string;
      OpenId: string;
    };
    static scopes: {
      Accounting: string;
      Payment: string;
      OpenId: string;
    };
    static environment: {
      sandbox: string;
      production: string;
    };
  }

  export = OAuthClient;
}
