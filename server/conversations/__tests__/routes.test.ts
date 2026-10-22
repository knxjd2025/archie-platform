import { describe, it, expect } from 'vitest';
import {
  normalizeGhlConversation,
  normalizeGmailMessage,
  normalizeJobTreadComment,
  filterConversationsForRep,
  type ConversationItem,
} from '../routes';

describe('normalizeGhlConversation', () => {
  it('maps a GHL SMS conversation to a normalized item', () => {
    const out = normalizeGhlConversation({
      id: 'ub9C',
      lastMessageType: 'TYPE_SMS',
      fullName: 'Brian Freeman',
      contactId: 'BS32',
      lastMessageBody: 'Ok sounds good',
      lastMessageDirection: 'outbound',
      lastMessageDate: 1788304865730,
      unreadCount: 0,
    });
    expect(out).toMatchObject({
      id: 'ub9C',
      source: 'ghl',
      channel: 'sms',
      contact: 'Brian Freeman',
      contactId: 'BS32',
      lastMessage: 'Ok sounds good',
      direction: 'outbound',
      date: 1788304865730,
      unread: 0,
    });
  });
  it('maps call/email channels and falls back to "other"', () => {
    expect(normalizeGhlConversation({ id: 'a', lastMessageType: 'TYPE_CALL' }).channel).toBe('call');
    expect(normalizeGhlConversation({ id: 'b', lastMessageType: 'TYPE_EMAIL' }).channel).toBe('email');
    expect(normalizeGhlConversation({ id: 'c', lastMessageType: 'TYPE_WEIRD' }).channel).toBe('other');
  });
  it('defaults contact to Unknown and tolerates missing fields', () => {
    expect(normalizeGhlConversation({ id: 'd' })).toMatchObject({
      contact: 'Unknown',
      lastMessage: '',
      unread: 0,
      date: 0,
    });
  });
});

describe('normalizeGmailMessage', () => {
  it('parses a display-name From and combines subject + snippet', () => {
    const out = normalizeGmailMessage({
      id: 'abc',
      from: 'Jane Doe <jane@example.com>',
      subject: 'Roof estimate',
      snippet: 'Thanks for coming by',
      date: 'Mon, 01 Sep 2026 10:00:00 -0400',
      unread: true,
    });
    expect(out).toMatchObject({
      id: 'gmail:abc',
      source: 'gmail',
      channel: 'email',
      contact: 'Jane Doe',
      direction: 'inbound',
      lastMessage: 'Roof estimate — Thanks for coming by',
      unread: 1,
    });
    expect(out.date).toBe(Date.parse('Mon, 01 Sep 2026 10:00:00 -0400'));
  });

  it('falls back to the bare address when there is no display name', () => {
    expect(normalizeGmailMessage({ id: 'x', from: 'bob@example.com', subject: 'Hi' }).contact).toBe('bob@example.com');
  });

  it('tolerates a missing/unparseable date', () => {
    expect(normalizeGmailMessage({ id: 'y', from: '', subject: '', snippet: '' }).date).toBe(0);
  });
});

describe('normalizeJobTreadComment', () => {
  it('maps an internal note to the JobTread "note" channel with author prefix', () => {
    const out = normalizeJobTreadComment({
      id: 'c1',
      message: 'September 22nd Install Date',
      createdAt: '2026-09-01T21:45:57.682Z',
      isFromEmail: false,
      author: 'James Turner',
      jobName: 'F White 0293',
      accountName: 'Forrest/Caitlin White',
    });
    expect(out).toMatchObject({
      id: 'jt:c1',
      source: 'jobtread',
      channel: 'note',
      contact: 'Forrest/Caitlin White',
      direction: 'outbound',
      lastMessage: 'James Turner: September 22nd Install Date',
    });
    expect(out.date).toBe(Date.parse('2026-09-01T21:45:57.682Z'));
  });

  it('treats an email-sourced comment as inbound email', () => {
    const out = normalizeJobTreadComment({ id: 'c2', message: 'hi', isFromEmail: true, accountName: 'Bob' });
    expect(out.channel).toBe('email');
    expect(out.direction).toBe('inbound');
  });

  it('collapses whitespace and caps the preview length', () => {
    const long = 'word '.repeat(200);
    const out = normalizeJobTreadComment({ id: 'c3', message: long, author: 'A', jobName: 'J' });
    expect(out.contact).toBe('J'); // falls back to job when no account
    expect(out.lastMessage.length).toBeLessThanOrEqual(280 + 'A: '.length);
    expect(out.lastMessage).not.toContain('  ');
  });
});

describe('filterConversationsForRep', () => {
  const item = (over: Partial<ConversationItem>): ConversationItem => ({
    id: 'i', source: 'ghl', channel: 'sms', contact: '', contactId: '', lastMessage: '', direction: '', date: 0, unread: 0, ...over,
  });
  const scope = { names: ['Forrest/Caitlin White', 'Brian Freeman'], jobNames: ['F White 0293'] };

  it('keeps GHL/JobTread items matching a client name and drops the rest', () => {
    const mine = item({ source: 'ghl', contact: 'Brian Freeman' });
    const notMine = item({ source: 'ghl', contact: 'Someone Else' });
    const jtMine = item({ source: 'jobtread', contact: 'Forrest/Caitlin White' });
    const out = filterConversationsForRep([mine, notMine, jtMine], scope);
    expect(out.map((c) => c.contact)).toEqual(['Brian Freeman', 'Forrest/Caitlin White']);
  });

  it('always keeps Gmail (the rep\'s own inbox)', () => {
    const gmail = item({ source: 'gmail', contact: 'Random Sender' });
    expect(filterConversationsForRep([gmail], scope)).toHaveLength(1);
  });

  it('matches case-insensitively and never leaks an unmatched contact', () => {
    const mine = item({ source: 'ghl', contact: 'brian freeman' });
    const leak = item({ source: 'ghl', contact: '' });
    const out = filterConversationsForRep([mine, leak], scope);
    expect(out).toHaveLength(1);
    expect(out[0].contact).toBe('brian freeman');
  });
});
