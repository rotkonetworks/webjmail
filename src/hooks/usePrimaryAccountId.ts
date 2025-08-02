import { useAuthStore } from '../stores/authStore'

export function usePrimaryAccountId() {
  const session = useAuthStore((state) => state.session)
  const accountId = session?.primaryAccounts?.['urn:ietf:params:jmap:mail'] || null
  
  return accountId
}
