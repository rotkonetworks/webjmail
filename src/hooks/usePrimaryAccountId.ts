import { useAuthStore } from '../stores/authStore'

export function usePrimaryAccountId() {
  const session = useAuthStore((state) => state.session)
  const accountId = session?.primaryAccounts?.['urn:ietf:params:jmap:mail'] || null
  
  if (import.meta.env.DEV) {
    console.log('[useJMAP] Primary account ID:', accountId)
  }
  
  return accountId
}
