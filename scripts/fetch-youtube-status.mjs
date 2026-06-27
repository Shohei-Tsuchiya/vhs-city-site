#!/usr/bin/env node
/**
 * YouTube 配信状況を取得し data/status.json を更新する。
 * RSS で最新動画 ID を取得し、videos.list で一括判定（search API 不使用）。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data');

const API_KEY = process.env.YOUTUBE_API_KEY;
const RSS_ENTRIES_PER_CHANNEL = Number(process.env.RSS_ENTRIES_PER_CHANNEL || 10);
const RSS_CONCURRENCY = Number(process.env.RSS_CONCURRENCY || 8);
const VIDEOS_LIST_CHUNK = 50;

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

function parseRssVideoIds(xml, limit) {
  const ids = [];
  const regex = /<yt:videoId>([^<]+)<\/yt:videoId>/g;
  let match;
  while ((match = regex.exec(xml)) !== null && ids.length < limit) {
    ids.push(match[1]);
  }
  return ids;
}

async function fetchRssVideoIds(channelId) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'VHS-City-Site/1.0 (fan dashboard)' },
  });

  if (!res.ok) {
    throw new Error(`RSS fetch failed (${res.status})`);
  }

  const xml = await res.text();
  return parseRssVideoIds(xml, RSS_ENTRIES_PER_CHANNEL);
}

async function mapPool(items, concurrency, mapper) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map(mapper));
    results.push(...chunkResults);
  }
  return results;
}

async function fetchVideosByIds(videoIds) {
  const uniqueIds = [...new Set(videoIds)];
  const videos = [];

  for (let i = 0; i < uniqueIds.length; i += VIDEOS_LIST_CHUNK) {
    const chunk = uniqueIds.slice(i, i + VIDEOS_LIST_CHUNK);
    const data = await apiGet('videos', {
      part: 'snippet,liveStreamingDetails,status',
      id: chunk.join(','),
    });
    videos.push(...(data.items || []));
  }

  return videos;
}

function buildStreamEntry(member, channelId, video) {
  const scheduledStart =
    video.liveStreamingDetails?.scheduledStartTime ||
    video.snippet?.publishedAt ||
    null;

  return {
    memberKey: `${member.groupId}:${member.name}`,
    name: member.name,
    groupId: member.groupId,
    groupName: member.groupName,
    groupColor: member.groupColor,
    channelId,
    handle: member.handle || null,
    videoId: video.id,
    title: video.snippet?.title || 'タイトル未取得',
    thumbnail:
      video.snippet?.thumbnails?.medium?.url ||
      video.snippet?.thumbnails?.default?.url ||
      null,
    scheduledStart,
    url: `https://www.youtube.com/watch?v=${video.id}`,
    checkedAt: new Date().toISOString(),
  };
}

async function main() {
  const membersConfig = readJson(join(DATA, 'members.json'), { groups: [] });
  const allMembers = flattenMembers(membersConfig.groups);
  const channelCache = readJson(join(DATA, 'channel-cache.json'), {});

  if (allMembers.length === 0) {
    console.log('メンバーが登録されていません');
    return;
  }

  const memberByChannel = new Map();
  const videoToMember = new Map();
  let channelResolveCalls = 0;
  let rssOk = 0;
  let rssFailed = 0;

  for (const member of allMembers) {
    let channelId;
    try {
      const hadCache =
        Boolean(member.channelId) ||
        Boolean(member.handle && channelCache[member.handle.toLowerCase()]);
      channelId = await resolveChannelId(member, channelCache);
      if (!hadCache && channelId) channelResolveCalls += 1;
    } catch (error) {
      console.warn(`Channel resolve failed for ${member.name}: ${error.message}`);
      continue;
    }

    if (!channelId) {
      console.warn(`Channel ID not found for ${member.name} (@${member.handle})`);
      continue;
    }

    memberByChannel.set(channelId, member);
  }

  const channelIds = [...memberByChannel.keys()];
  console.log(`Resolved ${channelIds.length} channel(s)`);

  const rssResults = await mapPool(channelIds, RSS_CONCURRENCY, async (channelId) => {
    const member = memberByChannel.get(channelId);
    try {
      const videoIds = await fetchRssVideoIds(channelId);
      rssOk += 1;
      return { channelId, member, videoIds };
    } catch (error) {
      rssFailed += 1;
      console.warn(`RSS failed for ${member.name}: ${error.message}`);
      return { channelId, member, videoIds: [] };
    }
  });

  const allVideoIds = [];
  for (const { channelId, member, videoIds } of rssResults) {
    for (const videoId of videoIds) {
      allVideoIds.push(videoId);
      if (!videoToMember.has(videoId)) {
        videoToMember.set(videoId, { member, channelId });
      }
    }
  }

  console.log(
    `RSS: ok=${rssOk}, failed=${rssFailed}, videoIds=${allVideoIds.length}`
  );

  const live = [];
  const upcoming = [];
  let videosListCalls = 0;

  if (allVideoIds.length > 0) {
    videosListCalls = Math.ceil(allVideoIds.length / VIDEOS_LIST_CHUNK);
    const videos = await fetchVideosByIds(allVideoIds);

    for (const video of videos) {
      const mapping = videoToMember.get(video.id);
      if (!mapping) continue;

      const broadcast = video.snippet?.liveBroadcastContent;
      if (broadcast !== 'live' && broadcast !== 'upcoming') continue;

      const entry = buildStreamEntry(mapping.member, mapping.channelId, video);
      entry.status = broadcast;

      if (broadcast === 'live') {
        live.push(entry);
      } else {
        upcoming.push(entry);
      }
    }
  }

  const dedupe = (items) => {
    const map = new Map();
    for (const item of items) {
      map.set(item.memberKey, item);
    }
    return [...map.values()];
  };

  const status = {
    updatedAt: new Date().toISOString(),
    live: dedupe(live).sort((a, b) => a.groupName.localeCompare(b.groupName, 'ja')),
    upcoming: dedupe(upcoming).sort((a, b) => {
      const ta = new Date(a.scheduledStart || 0).getTime();
      const tb = new Date(b.scheduledStart || 0).getTime();
      return ta - tb;
    }),
  };

  writeJson(join(DATA, 'channel-cache.json'), channelCache);
  writeJson(join(DATA, 'status.json'), status);

  const queriesThisRun = channelResolveCalls + videosListCalls;
  console.log(
    `Done. live=${status.live.length}, upcoming=${status.upcoming.length}, apiCalls=${queriesThisRun} (channels=${channelResolveCalls}, videos.list=${videosListCalls})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
