// FOLLOWERS / FOLLOWING, opened from the profile's stats.
//
// Void accounts come from the server's follows table. On your own FOLLOWING list,
// the creators you followed from reels (Bluesky, PeerTube, YouTube...) are added
// from this device - the table cannot hold them (reelStore's followedCreators).
import React, { useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import { srcName, VoidAPI } from '../../core';
import { Sheet } from '../../ui/Sheet';
import { openUser } from '../feed/navigation';
import { followedCreators } from '../reels/reelStore';
import { VEmpty, VHeader, VItem } from '../settings/vmod';
import { ProfileAvatar } from './ProfileAvatar';

export type FollowKind = 'followers' | 'following';
interface Row { key: string; uid?: string | null; handle: string; name: string; avatar?: string | null; source?: string }

async function loadRows(kind: FollowKind, uid: string | null, own: boolean): Promise<Row[]> {
  let rows: Row[] = [];
  if (uid) {
    const [col, other] = kind === 'following' ? ['follower_id', 'followee_id'] : ['followee_id', 'follower_id'];
    const links = await VoidAPI._sb(`/rest/v1/follows?${col}=eq.${uid}&select=${other}&limit=1000`, 'GET').catch(() => []);
    const ids: string[] = (links || []).map((r: any) => r[other]).filter(Boolean);
    if (ids.length) {
      const profs = await VoidAPI._sb(`/rest/v1/profiles?id=in.(${ids.join(',')})&select=id,handle,display_name,avatar_url`, 'GET').catch(() => []);
      rows = (profs || []).map((p: any) => ({ key: 'uid:' + p.id, uid: p.id, handle: p.handle || '', name: p.display_name || p.handle || 'Void user', avatar: p.avatar_url }));
    }
  }
  if (own && kind === 'following') {
    const have = new Set(rows.map((r) => r.uid));
    const local = followedCreators().filter((f) => !(f.uid && have.has(f.uid)));
    rows = rows.concat(local.map((f) => ({ key: 'h:' + f.h, uid: f.uid, handle: f.h, name: f.name, source: f.uid ? '' : f.source })));
  }
  return rows;
}

/** How many the device adds to your FOLLOWING beyond the server's rows. */
export function localFollowingExtra(serverIds: Set<string>): number {
  return followedCreators().filter((f) => !(f.uid && serverIds.has(f.uid))).length;
}

export function FollowListSheet({ kind: open, uid, own, onClose }: { kind: FollowKind | null; uid: string | null; own: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  // The sheet keeps its content through the exit slide after `open` goes null, so
  // the last list is what it shows on the way out - not the other list's title.
  const [kind, setKind] = useState<FollowKind>('following');
  if (open && open !== kind) setKind(open);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setRows(null);
    loadRows(open, uid, own).then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [open, uid, own]);

  return (
    <Sheet visible={!!open} onClose={onClose}>
      <VHeader title={kind === 'followers' ? 'FOLLOWERS' : 'FOLLOWING'} onClose={onClose} />
      {rows === null ? (
        <VEmpty>LOADING…</VEmpty>
      ) : !rows.length ? (
        <VEmpty>{kind === 'followers' ? 'NO FOLLOWERS YET' : 'NOT FOLLOWING ANYONE YET'}</VEmpty>
      ) : (
        rows.map((r) => {
          // A Void account opens its profile; a creator from another source has none here.
          const go = r.uid && r.handle ? () => openUser(r.handle) && onClose() : undefined;
          return (
            <Pressable key={r.key} disabled={!go} onPress={go} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}>
              <VItem
                left={<ProfileAvatar name={r.name} uid={r.uid || r.handle} url={r.avatar} size={32} />}
                label={r.name}
                sub={'@' + r.handle + (r.source ? ' · ' + srcName(r.source).toUpperCase() : '')}
              />
            </Pressable>
          );
        })
      )}
    </Sheet>
  );
}
