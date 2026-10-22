const fetch = require('node-fetch');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const JOBTREAD_API_BASE = 'https://api.jobtread.com';

class LeadAggregator {
  constructor() {
    this.ghlToken = process.env.GHL_LOCATION_API_KEY || process.env.GHL_AGENCY_API_KEY;
    this.ghlLocationId = process.env.GHL_LOCATION_ID;
    this.jobtreadToken = process.env.JOBTREAD_API_KEY;
    this.jobtreadCompanyId = process.env.JOBTREAD_COMPANY_ID;
    
    this.allLeads = [];
  }

  async fetchGHLContacts() {
    console.log('🔍 Fetching GoHighLevel contacts...');
    
    try {
      const response = await fetch(
        `${GHL_API_BASE}/contacts/?locationId=${this.ghlLocationId}&limit=100`,
        {
          headers: {
            'Authorization': `Bearer ${this.ghlToken}`,
            'Version': '2021-07-28',
            'Accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`GHL Error: ${response.status}`);
      }

      const data = await response.json();
      
      return (data.contacts || []).map(contact => ({
        source: 'GoHighLevel',
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        address: contact.address1,
        city: contact.city,
        state: contact.state,
        zip: contact.postalCode,
        tags: contact.tags || [],
        dateAdded: contact.dateAdded,
        sourceDetail: contact.source,
      }));
    } catch (error) {
      console.error('❌ GHL fetch failed:', error.message);
      return [];
    }
  }

  async fetchGHLOpportunities() {
    console.log('🔍 Fetching GoHighLevel opportunities...');
    
    try {
      const response = await fetch(
        `${GHL_API_BASE}/opportunities/search?location_id=${this.ghlLocationId}&limit=100`,
        {
          headers: {
            'Authorization': `Bearer ${this.ghlToken}`,
            'Version': '2021-07-28',
            'Accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`GHL Opportunities Error: ${response.status}`);
      }

      const data = await response.json();
      
      return (data.opportunities || []).map(opp => ({
        source: 'GoHighLevel Opportunity',
        id: opp.id,
        name: opp.name,
        status: opp.status,
        value: opp.monetaryValue,
        pipelineId: opp.pipelineId,
        stageId: opp.pipelineStageId,
        contactId: opp.contactId,
        dateCreated: opp.createdAt,
      }));
    } catch (error) {
      console.error('❌ GHL opportunities fetch failed:', error.message);
      return [];
    }
  }

  async fetchJobTreadContacts() {
    console.log('🔍 Fetching JobTread contacts...');
    
    try {
      const response = await fetch(
        `${JOBTREAD_API_BASE}/v1/contacts?limit=100`,
        {
          headers: {
            'Authorization': `Bearer ${this.jobtreadToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`JobTread Error: ${response.status}`);
      }

      const data = await response.json();
      
      return (data.contacts || []).map(contact => ({
        source: 'JobTread',
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        address: contact.address,
        city: contact.city,
        state: contact.state,
        zip: contact.zip,
        type: contact.type,
        dateAdded: contact.createdAt,
      }));
    } catch (error) {
      console.error('❌ JobTread fetch failed:', error.message);
      return [];
    }
  }

  async fetchJobTreadJobs() {
    console.log('🔍 Fetching JobTread jobs...');
    
    try {
      const response = await fetch(
        `${JOBTREAD_API_BASE}/v1/jobs?limit=100`,
        {
          headers: {
            'Authorization': `Bearer ${this.jobtreadToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`JobTread Jobs Error: ${response.status}`);
      }
      
      const data = await response.json();
      
      return (data.jobs || []).map(job => ({
        source: 'JobTread Job',
        id: job.id,
        name: job.name,
        status: job.status,
        customer: job.customer,
        address: job.address,
        value: job.contractAmount,
        dateCreated: job.createdAt,
      }));
    } catch (error) {
      console.error('❌ JobTread jobs fetch failed:', error.message);
      return [];
    }
  }

  categorizeLead(lead) {
    const now = new Date();
    const created = lead.dateAdded ? new Date(lead.dateAdded) : now;
    const daysSince = Math.floor((now - created) / (1000 * 60 * 60 * 24));
    
    // Determine priority
    let priority = 'COLD';
    let reason = '';
    
    if (daysSince <= 3) {
      priority = 'HOT';
      reason = 'Fresh lead - contact ASAP';
    } else if (daysSince <= 14) {
      priority = 'WARM';
      reason = 'Recent lead - follow up';
    } else if (daysSince <= 30) {
      priority = 'WARM';
      reason = 'This month - needs attention';
    } else {
      priority = 'COLD';
      reason = `Old lead (${daysSince} days) - re-engage`;
    }
    
    // Check for indicators of quality
    const hasPhone = lead.phone && lead.phone.length > 9;
    const hasEmail = lead.email && lead.email.includes('@');
    const hasAddress = lead.address || (lead.city && lead.state);
    
    if (hasPhone && hasEmail && hasAddress && priority === 'HOT') {
      priority = '🔥 HOT';
      reason = 'Complete info + fresh - CALL NOW';
    }
    
    return {
      ...lead,
      priority,
      reason,
      daysSince,
      hasPhone,
      hasEmail,
      hasAddress,
      quality: hasPhone && hasEmail ? 'HIGH' : hasPhone || hasEmail ? 'MEDIUM' : 'LOW',
    };
  }

  async aggregateAll() {
    console.log('\n🚀 Starting Lead Aggregation...\n');
    
    // Fetch from all sources
    const [ghlContacts, ghlOpps, jtContacts, jtJobs] = await Promise.all([
      this.fetchGHLContacts(),
      this.fetchGHLOpportunities(),
      this.fetchJobTreadContacts(),
      this.fetchJobTreadJobs(),
    ]);
    
    // Combine and categorize
    const allContacts = [
      ...ghlContacts.map(c => this.categorizeLead(c)),
      ...jtContacts.map(c => this.categorizeLead(c)),
    ];
    
    // Sort by priority
    const priorityOrder = { '🔥 HOT': 0, 'HOT': 1, 'WARM': 2, 'COLD': 3 };
    allContacts.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    
    // Group by priority
    const grouped = {
      hot: allContacts.filter(l => l.priority.includes('HOT')),
      warm: allContacts.filter(l => l.priority === 'WARM'),
      cold: allContacts.filter(l => l.priority === 'COLD'),
      opportunities: ghlOpps,
      jobs: jtJobs,
    };
    
    return grouped;
  }

  generateReport(data) {
    const report = `
╔═══════════════════════════════════════════════════════════════╗
║           BEST ROOFING NOW - LEAD AGGREGATION REPORT          ║
╚═══════════════════════════════════════════════════════════════╝

📊 SUMMARY:
• 🔥 HOT Leads (Call Today): ${data.hot.length}
• 🌡️ WARM Leads (This Week): ${data.warm.length}
• ❄️ COLD Leads (Re-engage): ${data.cold.length}
• 💰 Active Opportunities: ${data.opportunities.length}
• 🏗️ Active Jobs: ${data.jobs.length}
• 📈 TOTAL PROSPECTS: ${data.hot.length + data.warm.length + data.cold.length}

════════════════════════════════════════════════════════════════

🔥 PRIORITY 1: CALL THESE TODAY (${data.hot.length} leads)
════════════════════════════════════════════════════════════════
${data.hot.slice(0, 10).map((lead, i) => `
${i + 1}. ${lead.firstName || ''} ${lead.lastName || 'Unknown'}
   📞 ${lead.phone || 'NO PHONE'}
   📧 ${lead.email || 'NO EMAIL'}
   📍 ${lead.city || ''}, ${lead.state || ''}
   📅 Added: ${lead.daysSince} days ago
   🏷️ Source: ${lead.source}
   💡 Action: ${lead.reason}
`).join('\n')}

════════════════════════════════════════════════════════════════

🌡️ PRIORITY 2: FOLLOW UP THIS WEEK (${data.warm.length} leads)
════════════════════════════════════════════════════════════════
${data.warm.slice(0, 5).map((lead, i) => `
${i + 1}. ${lead.firstName || ''} ${lead.lastName || 'Unknown'}
   📞 ${lead.phone || 'NO PHONE'}
   📅 ${lead.daysSince} days old
   🏷️ ${lead.source}
`).join('\n')}

════════════════════════════════════════════════════════════════

💰 ACTIVE OPPORTUNITIES (${data.opportunities.length})
════════════════════════════════════════════════════════════════
${data.opportunities.slice(0, 5).map((opp, i) => `
${i + 1}. ${opp.name}
   💵 $${opp.value || 'Unknown'}
   📊 Status: ${opp.status}
   📅 ${new Date(opp.dateCreated).toLocaleDateString()}
`).join('\n')}

════════════════════════════════════════════════════════════════

📋 RECOMMENDED ACTIONS THIS WEEK:
════════════════════════════════════════════════════════════════
1. ☎️  Call all ${data.hot.length} HOT leads TODAY
2. 📧  Send follow-up to ${data.warm.length} WARM leads
3. 🔄  Re-engage ${data.cold.length} COLD leads with email campaign
4. 💰  Follow up on ${data.opportunities.filter(o => o.status === 'open').length} open opportunities
5. 📸  Check ${data.jobs.filter(j => j.status === 'in_progress').length} active job sites

════════════════════════════════════════════════════════════════

Generated: ${new Date().toLocaleString()}
`;

    return report;
  }

  async run() {
    try {
      const data = await this.aggregateAll();
      const report = this.generateReport(data);
      
      // Save to file
      fs.writeFileSync('LEAD_REPORT.txt', report);
      fs.writeFileSync('leads_data.json', JSON.stringify(data, null, 2));
      
      console.log(report);
      console.log('\n✅ Reports saved to:');
      console.log('   • LEAD_REPORT.txt (readable)');
      console.log('   • leads_data.json (full data)');
      
      return data;
    } catch (error) {
      console.error('❌ Aggregation failed:', error);
    }
  }
}

// Run if called directly
if (require.main === module) {
  const aggregator = new LeadAggregator();
  aggregator.run();
}

module.exports = LeadAggregator;
