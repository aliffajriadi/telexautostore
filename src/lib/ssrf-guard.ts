import { URL } from 'node:url';
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { isProd } from '../config/env.js';

const blockList = new net.BlockList();
// IPv4: "this network", private, CGNAT, loopback, link-local, benchmarking, multicast/reserved
blockList.addSubnet('0.0.0.0', 8, 'ipv4');
blockList.addSubnet('10.0.0.0', 8, 'ipv4');
blockList.addSubnet('100.64.0.0', 10, 'ipv4');
blockList.addSubnet('127.0.0.0', 8, 'ipv4');
blockList.addSubnet('169.254.0.0', 16, 'ipv4');
blockList.addSubnet('172.16.0.0', 12, 'ipv4');
blockList.addSubnet('192.0.0.0', 24, 'ipv4');
blockList.addSubnet('192.168.0.0', 16, 'ipv4');
blockList.addSubnet('198.18.0.0', 15, 'ipv4');
blockList.addSubnet('224.0.0.0', 3, 'ipv4');
// IPv6: unspecified, loopback, unique-local, link-local, multicast
blockList.addAddress('::', 'ipv6');
blockList.addAddress('::1', 'ipv6');
blockList.addSubnet('fc00::', 7, 'ipv6');
blockList.addSubnet('fe80::', 10, 'ipv6');
blockList.addSubnet('ff00::', 8, 'ipv6');

export function isPrivateIp(ip: string): boolean {
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) → check the embedded IPv4
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return blockList.check(mapped[1], 'ipv4');
  const family = net.isIP(ip);
  if (family === 4) return blockList.check(ip, 'ipv4');
  if (family === 6) return blockList.check(ip, 'ipv6');
  return true; // not an IP at all → refuse
}

/**
 * Validates a URL for use as an AutoStore base URL.
 * In production, rejects localhost and private IP ranges (SSRF protection).
 * In development, allows local URLs.
 * Throws an Error with a user-friendly message if invalid.
 */
export async function validateAutoStoreUrl(raw: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('URL tidak valid.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL harus menggunakan protokol http atau https.');
  }

  if (!isProd) {
    // Allow local URLs in development
    return;
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('URL tidak diizinkan: alamat lokal tidak boleh digunakan di produksi.');
  }

  // Resolve DNS and check all returned IPs
  let addresses: string[];
  try {
    const result = await dns.promises.lookup(hostname, { all: true });
    addresses = result.map((r) => r.address);
  } catch {
    throw new Error(`Tidak bisa memvalidasi host: resolusi DNS gagal untuk ${hostname}.`);
  }

  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      throw new Error('URL tidak diizinkan: mengarah ke IP privat atau lokal.');
    }
  }
}

/**
 * DNS lookup that refuses private addresses at connect time. Checking only when
 * the URL is saved isn't enough: the DNS record can change afterwards (DNS rebinding).
 */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err, address as string, family);
    const list = Array.isArray(address) ? address.map((a) => a.address) : [address];
    if (list.some(isPrivateIp)) {
      return callback(
        Object.assign(new Error('Alamat tujuan diblokir (IP privat/lokal).'), { code: 'EBLOCKED' }),
        address as string,
        family,
      );
    }
    callback(null, address as string, family);
  });
};

/** HTTP(S) agents for outbound AutoStore requests; guarded only in production. */
export const outboundAgents = isProd
  ? {
      httpAgent: new http.Agent({ lookup: guardedLookup }),
      httpsAgent: new https.Agent({ lookup: guardedLookup }),
    }
  : {};
