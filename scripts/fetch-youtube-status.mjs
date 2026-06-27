#!/usr/bin/env node
/**
 * YouTube 配信状況を取得し data/status.json を更新する。
 * API クォータ節約のため、1 回の実行で少数メンバーだけポーリングする。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data');

const API_KEY = process.env.YOUTUBE_API_KEY;
const MEMBERS_PER_RUN = Number(process.env.MEMBERS_PER_RUN || 2);

if (!API_KEY) {
  console.error('YOUTUBE_API_KEY が設定されていません');
  process.exit(1);
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function flattenMembers(groups) {
  return groups.flatMap((group) =>
    group.members.map((member) => ({
      ...member,
      groupId: group.id,
      groupName: group.name,
      groupColor: group.color,
    }))
  );
}

async function apiGet(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('key', API_KEY);

  const res = await fetch(url);
  const body = await res.json();

  if (!res.ok) {
    const message = body?.error?.message || res.statusText;
    throw new Error(`YouTube API error (${endpoint}): ${message}`);
  }

  return body;
}

async function resolveChannelId(member, cache) {
  if (member.channelId) return member.channelId;
  if (!member.handle) return null;

  const cacheKey = member.handle.toLowerCase();
  if (cache[cacheKey]) return cache[cacheKey];

  const handle = member.handle.replace(/^@/, '');
  const data = await apiGet('channels', {
    part: 'id',
    forHandle: handle,
  });

  const channelId = data.items?.[0]?.id;
  if (channelId) {
    cache[cacheKey] = channelId;
  }
  return channelId;
}

async function searchBroadcast(channelId, eventType) {
  const data = await apiGet('search', {
    part: 'snippet',
    channelId,
    eventType,
    type: 'video',
    maxResults: '3',
    order: 'date',
  });

  return (data.items || []).map((item) => ({
    videoId: item.id?.videoId,
    title: item.snippet?.title,
    thumbnail:
      item.snippet?.thumbnails?.medium?.url ||
      item.snippet?.thumbnails?.default?.url,
    scheduledStart: item.snippet?.publishedAt,
    url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
  }));
}

function upsertByKey(list, entry, keyFn) {
  const key = keyFn(entry);
  const index = list.findIndex((item) => keyFn(item) === key);
  if (index === -1) {
    list.push(entry);
    return;
  }
  list[index] = entry;
}

function removeStale(list, memberKey, maxAgeMs) {
  const now = Date.now();
  return list.filter((item) => {
    if (item.memberKey !== memberKey) return true;
    if (!item.checkedAt) return false;
    return now - new Date(item.checkedAt).getTime() < maxAgeMs;
  });
}

async function main() {
  const membersConfig = readJson(join(DATA, 'members.json'), { groups: [] });
  const allMembers = flattenMembers(membersConfig.groups);
  const fetchState = readJson(join(DATA, 'fetch-state.json'), { nextIndex: 0 });
  const channelCache = readJson(join(DATA, 'channel-cache.json'), {});
  const status = readJson(join(DATA, 'status.json'), {
    updatedAt: null,
    live: [],
    upcoming: [],
  });

  if (allMembers.length === 0) {
    console.log('メンバーが登録されていません');
    return;
  }

  const batch = [];
  let index = fetchState.nextIndex % allMembers.length;
  for (let i = 0; i < Math.min(MEMBERS_PER_RUN, allMembers.length); i++) {
    batch.push(allMembers[index]);
    index = (index + 1) % allMembers.length;
  }
  fetchState.nextIndex = index;

  console.log(`Checking ${batch.length} member(s): ${batch.map((m) => m.name).join(', ')}`);

  for (const member of batch) {
    const memberKey = `${member.groupId}:${member.name}`;
    let channelId;

    try {
      channelId = await resolveChannelId(member, channelCache);
    } catch (error) {
      console.warn(`Channel resolve failed for ${member.name}: ${error.message}`);
      continue;
    }

    if (!channelId) {
      console.warn(`Channel ID not found for ${member.name} (@${member.handle})`);
      continue;
    }

    const base = {
      memberKey,
      name: member.name,
      groupId: member.groupId,
      groupName: member.groupName,
      groupColor: member.groupColor,
      channelId,
      handle: member.handle || null,
      checkedAt: new Date().toISOString(),
    };

    try {
      const liveItems = await searchBroadcast(channelId, 'live');
      status.live = removeStale(status.live, memberKey, 45 * 60 * 1000);
      if (liveItems.length > 0) {
        for (const item of liveItems) {
          upsertByKey(
            status.live,
            { ...base, ...item, status: 'live' },
            (x) => `${x.memberKey}:${x.videoId}`
          );
        }
      } else {
        status.live = status.live.filter((item) => item.memberKey !== memberKey);
      }
    } catch (error) {
      console.warn(`Live search failed for ${member.name}: ${error.message}`);
    }

    try {
      const upcomingItems = await searchBroadcast(channelId, 'upcoming');
      status.upcoming = removeStale(status.upcoming, memberKey, 6 * 60 * 60 * 1000);
      if (upcomingItems.length > 0) {
        for (const item of upcomingItems) {
          upsertByKey(
            status.upcoming,
            { ...base, ...item, status: 'upcoming' },
            (x) => `${x.memberKey}:${x.videoId}`
          );
        }
      } else {
        status.upcoming = status.upcoming.filter((item) => item.memberKey !== memberKey);
      }
    } catch (error) {
      console.warn(`Upcoming search failed for ${member.name}: ${error.message}`);
    }
  }

  status.updatedAt = new Date().toISOString();
  status.live.sort((a, b) => a.groupName.localeCompare(b.groupName, 'ja'));
  status.upcoming.sort((a, b) => {
    const ta = new Date(a.scheduledStart || 0).getTime();
    const tb = new Date(b.scheduledStart || 0).getTime();
    return ta - tb;
  });

  writeJson(join(DATA, 'fetch-state.json'), fetchState);
  writeJson(join(DATA, 'channel-cache.json'), channelCache);
  writeJson(join(DATA, 'status.json'), status);

  console.log(`Done. live=${status.live.length}, upcoming=${status.upcoming.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
