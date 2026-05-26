export function resolveProviderCredentials(provider: any) {
  return {
    apiKey: provider?.apiKey || provider?.api_key || process.env.OPENAI_API_KEY || "",
    baseUrl: provider?.baseUrl || provider?.base_url || process.env.OPENAI_BASE_URL || "",
    providerKey: provider?.key || provider?.providerKey || "",
    supportOpenAI: provider?.supportOpenAI ?? true,
    isThirdParty: provider?.isThirdParty ?? true,
  }
}
