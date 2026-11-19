/**
 * A new contact arrived from the company's KynexPro (the GoHighLevel
 * webhook, server/routes.ts). Decides whether it is a lead, and if so hands
 * it to the marketing advisor. Must run as the company.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { agents } from '../../../shared/schema';
import { toAgentConfig } from '../../agents/base-agent';
import { CMOAgent } from '../../agents/cmo-agent';
import { getTeamMemberByEmail } from '../../storage/team';
import { isRoofLeeContact } from '../../sister/quiet';
import { getCurrentCompany } from '../../tenant/companies';
import { keepsOwnJobs } from '../../production/native-jobs';
import { GoHighLevelClient } from '../gohighlevel';

export type NewContactOutcome = 'roofli_company' | 'roofli' | 'team_member' | 'no_advisor' | 'lead';

export async function handleGhlNewContact(data: any): Promise<NewContactOutcome> {
  // A company Roof Lee made: Roof Lee's lead hub is the only way a lead comes
  // in, and its KynexPro is Roof Lee's. Taking a contact in here would make a
  // lead Roof Lee never saw, keyed to KynexPro, and send it back as news. So:
  // nothing at all, whoever made the contact.
  if (keepsOwnJobs(await getCurrentCompany())) {
    console.log('[webhook] new GHL contact for a company Roof Lee made; not taken in as a lead');
    return 'roofli_company';
  }

  // A contact Roof Lee made is already Roof Lee's lead. Taking it in here
  // would make a second lead, send it straight back to Roof Lee as news, and
  // text the customer. So: nothing at all.
  if (isRoofLeeContact(data)) {
    console.log('[webhook] new GHL contact was made by Roof Lee; not taken in as a lead');
    return 'roofli';
  }

  // The company's own people become GHL contacts when Archie emails
  // them (a set-password link, a reminder). They are not leads.
  const contactEmail = String(data?.email || '').trim().toLowerCase();
  if (contactEmail && (await getTeamMemberByEmail(contactEmail))) {
    console.log('[webhook] new GHL contact is a team member; not treated as a lead');
    return 'team_member';
  }

  const [agentRow] = await db.select().from(agents).where(eq(agents.role, 'cmo'));
  if (!agentRow) return 'no_advisor';

  const cmo = new CMOAgent(toAgentConfig(agentRow));
  const leadData = new GoHighLevelClient().contactToLead(data);
  const result = await cmo.handleNewLead({
    ...leadData,
    serviceType: data.customField?.serviceType || data.tags?.find?.((t: string) =>
      ['repair', 'replacement', 'inspection'].includes(String(t).toLowerCase())
    ),
    propertyType: data.customField?.propertyType,
  });
  console.log('Lead processed:', result);
  return 'lead';
}
