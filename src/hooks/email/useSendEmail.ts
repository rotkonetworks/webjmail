import { useMutation, useQueryClient } from '@tanstack/react-query'
import { jmapClient } from '../../api/jmap'
import { useAuthStore } from '../../stores/authStore'
import { usePrimaryAccountId } from '../usePrimaryAccountId'

export function useSendEmail() {
  const queryClient = useQueryClient()
  const accountId = usePrimaryAccountId()
  const session = useAuthStore((state) => state.session)

  return useMutation({
    mutationFn: async ({
      to,
      cc,
      bcc,
      subject,
      textBody,
      htmlBody,
      inReplyTo,
      attachments,
    }: {
      to: Array<{ name?: string; email: string }>
      cc?: Array<{ name?: string; email: string }>
      bcc?: Array<{ name?: string; email: string }>
      subject: string
      textBody?: string
      htmlBody?: string
      inReplyTo?: string
      attachments?: Array<{ blobId: string; type: string; name: string }>
    }) => {
      if (!accountId) throw new Error('No account ID')
      if (!session) throw new Error('No session')

      console.log('[useSendEmail] Sending email:', { to, subject, accountId })

      // Validation
      if (!to || to.length === 0) {
        throw new Error('At least one recipient is required')
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      const validateEmailAddresses = (
        addresses: Array<{ name?: string; email: string }>,
        fieldName: string
      ) => {
        for (const addr of addresses) {
          if (!addr.email || !emailRegex.test(addr.email)) {
            throw new Error(`Invalid email address in ${fieldName}: ${addr.email}`)
          }
        }
      }

      validateEmailAddresses(to, 'to')
      if (cc) validateEmailAddresses(cc, 'cc')
      if (bcc) validateEmailAddresses(bcc, 'bcc')

      // Get user's identity first
      const identityResponse = await jmapClient.request([
        [
          'Identity/get',
          {
            accountId,
            properties: null
          },
          'getIdentity'
        ]
      ])

      const [, identityResult] = identityResponse[0]
      const identity = identityResult.list?.[0]
      
      if (!identity) {
        throw new Error('No identity found for account')
      }

      console.log('[useSendEmail] Using identity:', identity)

      // Find the drafts and sent mailboxes
      const mailboxes = await jmapClient.getMailboxes(accountId)
      const draftsMailbox = mailboxes.find(m => m.role === 'drafts')
      const sentMailbox = mailboxes.find(m => m.role === 'sent')
      
      if (!draftsMailbox) {
        throw new Error('No drafts mailbox found')
      }

      // Use identity email
      const fromEmail = identity.email || session.username
      
      console.log('[useSendEmail] Using from email:', fromEmail)
      console.log('[useSendEmail] Using mailboxes:', {
        drafts: draftsMailbox.id,
        sent: sentMailbox?.id
      })

      // Build body structure according to JMAP spec
      const bodyStructure: any = {
        type: 'text/plain',
        partId: 'text',
      }

      const bodyValues: any = {
        'text': {
          value: textBody || '',
          isEncodingProblem: false,
          isTruncated: false
        }
      }

      // If we have HTML, make it multipart
      if (htmlBody) {
        bodyStructure.type = 'multipart/alternative'
        bodyStructure.subParts = [
          {
            type: 'text/plain',
            partId: 'text'
          },
          {
            type: 'text/html',
            partId: 'html'
          }
        ]
        delete bodyStructure.partId

        bodyValues['html'] = {
          value: htmlBody,
          isEncodingProblem: false,
          isTruncated: false
        }
      }

      // Step 1: Create the email in drafts folder
      const emailData: any = {
        mailboxIds: { [draftsMailbox.id]: true },
        keywords: { '$draft': true, '$seen': true },
        from: [{ 
          email: fromEmail, 
          name: identity.name || null 
        }],
        to: to,
        subject: subject || '',
        sentAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        bodyStructure: bodyStructure,
        bodyValues: bodyValues
      }

      // Add optional fields only if they have values
      if (cc && cc.length > 0) emailData.cc = cc
      if (bcc && bcc.length > 0) emailData.bcc = bcc
      if (inReplyTo) {
        emailData.inReplyTo = [inReplyTo]
        emailData.references = [inReplyTo]
      }

      console.log('[useSendEmail] Creating email with data:', emailData)

      const createResponse = await jmapClient.request([
        [
          'Email/set',
          {
            accountId,
            create: {
              'draftEmail': emailData
            }
          },
          'create'
        ]
      ])

      console.log('[useSendEmail] Create response:', createResponse)

      const [, createResult] = createResponse[0]
      
      // Check for creation errors
      if (createResult.notCreated?.draftEmail) {
        const error = createResult.notCreated.draftEmail
        console.error('[useSendEmail] Failed to create draft:', error)
        
        // If property error, show which property
        if (error.type === 'invalidProperties' && error.properties) {
          throw new Error(`Invalid properties: ${error.properties.join(', ')}. ${error.description || ''}`)
        }
        
        throw new Error(error.description || `Failed to create draft: ${error.type}`)
      }

      if (!createResult.created?.draftEmail) {
        console.error('[useSendEmail] No draft created in response:', createResult)
        throw new Error('Failed to create draft email')
      }

      const draftId = createResult.created.draftEmail.id
      console.log('[useSendEmail] Created draft with ID:', draftId)

      // Step 2: Submit the email with identityId
      const submitResponse = await jmapClient.request([
        [
          'EmailSubmission/set',
          {
            accountId,
            create: {
              'submission': {
                identityId: identity.id, // Add the required identityId
                emailId: draftId,
                envelope: {
                  mailFrom: { email: fromEmail },
                  rcptTo: [
                    ...to.map(addr => ({ email: addr.email })),
                    ...(cc || []).map(addr => ({ email: addr.email })),
                    ...(bcc || []).map(addr => ({ email: addr.email }))
                  ]
                }
              }
            },
            onSuccessUpdateEmail: sentMailbox ? {
              [draftId]: {
                'keywords/$draft': null,
                'keywords/$sent': true,
                [`mailboxIds/${draftsMailbox.id}`]: null,
                [`mailboxIds/${sentMailbox.id}`]: true
              }
            } : undefined
          },
          'submit'
        ]
      ])

      console.log('[useSendEmail] Submit response:', submitResponse)

      const [, submitResult] = submitResponse[0]
      
      // Check for submission errors
      if (submitResult.notCreated?.submission) {
        const error = submitResult.notCreated.submission
        console.error('[useSendEmail] Failed to submit:', error)
        throw new Error(error.description || `Failed to submit email: ${error.type}`)
      }

      if (!submitResult.created?.submission) {
        console.error('[useSendEmail] No submission created:', submitResult)
        throw new Error('Failed to submit email')
      }

      console.log('[useSendEmail] Email submitted successfully')

      // If onSuccessUpdateEmail didn't work, manually move to sent
      if (sentMailbox && !submitResult.updated?.[draftId]) {
        try {
          await jmapClient.request([
            [
              'Email/set',
              {
                accountId,
                update: {
                  [draftId]: {
                    mailboxIds: { [sentMailbox.id]: true },
                    keywords: { '$sent': true, '$seen': true }
                  }
                }
              },
              'moveToSent'
            ]
          ])
          console.log('[useSendEmail] Moved to sent folder')
        } catch (error) {
          console.warn('[useSendEmail] Failed to move to sent:', error)
        }
      }

      return { createResult, submitResult }
    },
    onSuccess: () => {
      if (accountId) {
        // Refresh emails to show the sent message
        queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
        queryClient.invalidateQueries({ queryKey: ['mailboxes', accountId] })
      }
    },
    onError: (error) => {
      console.error('[useSendEmail] Email send failed:', error.message || 'Unknown error')
    },
  })
}
