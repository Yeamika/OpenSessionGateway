import {
  createLinkHandshake,
  validateLinkHandshake,
  PROTOCOL_VERSION,
} from '../src/link-handshake';
import {
  ROUTER_OPS,
  REQUIRED_PERMISSIONS,
} from '../src/router-ops';

describe('LinkHandshake', () => {
  it('creates a valid LinkHandshake with default metadata', () => {
    const hs = createLinkHandshake('test-peer');
    expect(hs.type).toBe('link_handshake');
    expect(hs.protocol_version).toBe(PROTOCOL_VERSION);
    expect(hs.peer_id).toBe('test-peer');
    expect(hs.metadata).toEqual({});
  });

  it('creates a valid LinkHandshake with custom metadata', () => {
    const metadata = { role: 'session-control', version: '0.1.0' };
    const hs = createLinkHandshake('test-peer', metadata);
    expect(hs.metadata).toEqual(metadata);
  });

  it('validates a correct LinkHandshake', () => {
    const hs = createLinkHandshake('test-peer');
    expect(validateLinkHandshake(hs)).toBe(true);
  });

  it('rejects null', () => {
    expect(validateLinkHandshake(null)).toBe(false);
  });

  it('rejects wrong type', () => {
    expect(validateLinkHandshake({ type: 'wrong', protocol_version: 1, peer_id: 'x' })).toBe(false);
  });

  it('rejects missing protocol_version', () => {
    expect(validateLinkHandshake({ type: 'link_handshake', peer_id: 'x' })).toBe(false);
  });

  it('rejects missing peer_id', () => {
    expect(validateLinkHandshake({ type: 'link_handshake', protocol_version: 1 })).toBe(false);
  });

  it('accepts missing metadata (optional)', () => {
    expect(validateLinkHandshake({ type: 'link_handshake', protocol_version: 1, peer_id: 'x' })).toBe(true);
  });

  it('rejects non-object metadata', () => {
    expect(validateLinkHandshake({ type: 'link_handshake', protocol_version: 1, peer_id: 'x', metadata: 'bad' })).toBe(false);
  });

  it('does not depend on legacy role/capabilities fields', () => {
    const hs = createLinkHandshake('test-peer');
    expect('role' in hs).toBe(false);
    expect('capabilities' in hs).toBe(false);
  });
});

describe('RouterOps', () => {
  it('defines all required operations', () => {
    expect(ROUTER_OPS.ANNOUNCE_ROUTE).toBe('announce.route');
    expect(ROUTER_OPS.CONTROL_ADD_PROMPT).toBe('control.add_prompt');
    expect(ROUTER_OPS.SESSION_LIST).toBe('session.list');
    expect(ROUTER_OPS.SESSION_READ).toBe('session.read');
    expect(ROUTER_OPS.ROUTE_LIST).toBe('route.list');
    expect(ROUTER_OPS.ADMIN_REQUEST).toBe('admin.request');
  });

  it('REQUIRED_PERMISSIONS includes essential read and control ops', () => {
    expect(REQUIRED_PERMISSIONS).toContain('announce.route');
    expect(REQUIRED_PERMISSIONS).toContain('control.add_prompt');
    expect(REQUIRED_PERMISSIONS).toContain('session.list');
    expect(REQUIRED_PERMISSIONS).toContain('session.read');
    expect(REQUIRED_PERMISSIONS).toContain('route.list');
  });

  it('REQUIRED_PERMISSIONS does not include admin write ops by default', () => {
    expect(REQUIRED_PERMISSIONS).not.toContain('admin.rules.write');
    expect(REQUIRED_PERMISSIONS).not.toContain('admin.routes.write');
  });
});
