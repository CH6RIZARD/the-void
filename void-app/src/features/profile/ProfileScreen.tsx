// PROFILE v3 (patch3 §2) — #screen-profile, CSS 1:1 from void2-final.html 486-586 + 1155-1160.
//   <ProfileScreen />                 own profile (tab)
//   <ProfileScreen handle="alice" />  other user (/u/[handle]): MESSAGE + block / report
// With no prop, a `handle` route param is honoured, so A's /u/[handle] route can render it bare.
// DROPS render as <PostCard surface="profile"> in a FlatList with usePostViewability('profile')
// and one <ModerationHost/> for the ⋯ sheets.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { moderation, readJSON, VoidAPI, writeJSON, type Post } from '../../core';
import { useTheme } from '../../theme';
import { FONTS, em, type RadialSpec } from '../../theme/palettes';
import { RadialFill } from '../../ui/Surface';
import { VText } from '../../ui/Text';
import { Icon } from '../../ui/icons/Icon';
import { voidToast } from '../../ui/Toast';
import { useBottomNavSpace } from '../../nav/layout';
import { ROUTES } from '../../nav/routes';
import { ModerationHost, openThreadRoute, PostCard, usePostViewability } from '../feed';
import { fmt } from '../feed/format';
import { ensureCore, useIdentity } from '../auth/coreBridge';
import { stripHandle } from '../auth/handles';
import { onDropPosted } from '../composer/drop';
import { usePendingDrops } from '../composer/dropStore';
import { openDmWith } from '../messages/MessagesScreen';
import { MiniIcon } from '../settings/vmod';
import { AccountSheet, voidAuthor } from './AccountSheet';
import { EditProfileSheet } from './EditProfileSheet';
import { FollowListSheet, localFollowingExtra, type FollowKind } from './FollowListSheet';
import { ProfileAvatar } from './ProfileAvatar';
import { fetchDrops, fetchHearted, fetchMyProfile, fetchProfileByHandle, fetchReplies, getLocalAvatar, openReplyThread, registerOffFeed, type ProfileRow } from './profileApi';

/** --prof-glow (VOID): radial-gradient(110% 45% at 50% 0%,#120830 0%,#04020c 58%) */
const PROF_GLOW: RadialSpec = { rx: 110, ry: 45, cx: 50, cy: 0, stops: [{ color: '#120830', offset: 0 }, { color: '#04020c', offset: 0.58 }] };
export const PROFILE_SHARE_BASE = 'https://void-app-d35c.pages.dev/';

function Empty({ text, pad = 30 }: { text: string; pad?: number }) {
  const { colors } = useTheme();
  return <VText align="center" style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.12), color: colors.muted, padding: pad }}>{text}</VText>;
}

// Module-level, so PostCard's memo and its `open` callback deps stay stable. Through
// openThreadRoute, so a hidden post gets the same toast it gets everywhere else.
function openProfilePost(id: string, p: Post) {
  registerOffFeed(p);
  openThreadRoute(id);
}
// A reply opens its root thread with the reply focused, not a thread of its own.
function openProfileReply(_id: string, p: Post) {
  openReplyThread(p);
}

const TILE_KEY = 'void.profile.layout';
type ProfTab = 'drops' | 'hearted' | 'replies';
type ProfLayout = 'scroll' | 'tiles';

/**
 * One square of the tile grid - the 6p-f tile (handoff/profile-6pf.html:34).
 *
 * Every drop kind has to read at a third of the screen width, where there is no
 * room for a card. Media fills the square; a clip gets a centred gold play disc,
 * a gallery a corner stack glyph, a live drop a red dot; a voice drop draws its
 * waveform, because a voice post with its media hidden is otherwise
 * indistinguishable from an empty one; a text drop shows its first lines, which
 * is all it has. Every kind carries the place / hearts strip along the bottom.
 * The colours are the mock's void values, not theme tokens: the tile is a dark
 * object on every theme, like the media it usually holds.
 */
/**
 * A light glyph over a photo, with the mock's drop-shadow(0 1px 2px #000): the same
 * glyph drawn first in translucent black 1px lower, then the light one on top, so the
 * shadow follows the stroke. A boxShadow on the wrapper shadows its empty round box
 * instead, a dark halo on a bright photo.
 */
function ShadowedIcon({ name, size, strokeWidth }: { name: React.ComponentProps<typeof Icon>['name']; size: number; strokeWidth?: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <View style={st.glyphShadow}><Icon name={name} size={size} color="rgba(0,0,0,0.6)" strokeWidth={strokeWidth} /></View>
      <Icon name={name} size={size} color="#f4f0ff" strokeWidth={strokeWidth} />
    </View>
  );
}

const ProfileTile = React.memo(function ProfileTile({ post, size, onPress }: { post: Post; size: number; onPress: () => void }) {
  const img = post._img || (post._imgs && post._imgs[0]) || null;
  const isVoice = post.style === 'audio' || !!post._audio;
  const isClip = post.style === 'video' || !!post._video;
  const isGallery = post.style === 'carousel' || (post._imgs ? post._imgs.length > 1 : false);
  const isLive = post.style === 'link_live' || !!post._live;
  const place = (post._regionName || post.country || '').toUpperCase();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={post.body ? post.body.slice(0, 60) : 'Drop'}
      style={[st.tile, { width: size, height: size }]}
    >
      {img ? (
        <Image source={{ uri: img }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : isVoice ? (
        <View style={st.tileVoice}>
          {/* 25 bars sharing the width, first 9 lit. Seeded from the id, not the
              mock's fixed WAVE, so each drop keeps its own shape across renders
              and layouts. */}
          <View style={st.tileWave}>
            {Array.from({ length: 25 }, (_, i) => {
              const seed = (post.id.charCodeAt(i % post.id.length) * 31 + i * 17) % 100;
              return <View key={i} style={[st.tileBar, { height: 3 + (seed / 100) * 15, backgroundColor: i < 9 ? '#8d7cc0' : '#3a2f60' }]} />;
            })}
          </View>
          <View style={st.tileVoicePlay}><Icon name="play" size={9} color="#c9a84c" /></View>
        </View>
      ) : (
        <VText numberOfLines={5} style={st.tileText}>{(post.body || '').trim() || '—'}</VText>
      )}
      {isClip ? (
        <View style={st.tileClipWrap} pointerEvents="none">
          <View style={st.tileClip}><Icon name="play" size={11} color="#c9a84c" /></View>
        </View>
      ) : null}
      {isGallery ? <View style={st.tileGlyph}><ShadowedIcon name="stack" size={12} strokeWidth={2} /></View> : null}
      {/* ponytail: static dot, the mock blinks it (1.2s); add an Animated loop if wanted. */}
      {isLive ? <View style={st.tileLive}><View style={st.tileLiveDot} /></View> : null}
      <View style={st.tileFoot} pointerEvents="none">
        <VText numberOfLines={1} style={[st.tileFootText, { flex: 1 }]}>{place}</VText>
        {/* A heart, not the mock's bolt: reactions are hearts now. Shadowed like the
            text beside it (the mock's bolt is inside the shadowed span). */}
        <ShadowedIcon name="heart" size={7} />
        <VText style={[st.tileFootText, { marginLeft: 2 }]}>{post.score || 0}</VText>
      </View>
    </Pressable>
  );
});

export default function ProfileScreen({ handle: handleProp }: { handle?: string }) {
  const params = useLocalSearchParams<{ handle?: string }>();
  const { colors, name: themeName, isLight } = useTheme();
  const insets = useSafeAreaInsets();
  const navSpace = useBottomNavSpace();
  const { user } = useIdentity();
  const requested = stripHandle(String(handleProp || params.handle || ''));
  const isOther = !!requested && requested !== stripHandle(user.handle);
  const viewability = usePostViewability('profile');

  const [other, setOther] = useState<ProfileRow | null | undefined>(undefined);
  // My own row. It was fetched and thrown away except for the avatar; the banner
  // and the join date are on it too.
  const [me, setMe] = useState<ProfileRow | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [drops, setDrops] = useState<Post[] | null>(null);
  const [counts, setCounts] = useState<{ following: number; followers: number } | null>(null);
  const [followList, setFollowList] = useState<FollowKind | null>(null);
  // DROPS / HEARTED / REPLIES, per the handoff notes. Messages moved off the
  // profile: it is a tab of its own in the nav, and the notes' tab row has no
  // room for it.
  const [tab, setTab] = useState<ProfTab>('drops');
  const [hearted, setHearted] = useState<Post[] | null>(null);
  const [replies, setReplies] = useState<Post[] | null>(null);
  // Per-user and persisted, as the patch notes ask: whichever way you last chose
  // to look at a profile is how it opens next time.
  const [layout, setLayout] = useState<ProfLayout>(() => (readJSON<ProfLayout>(TILE_KEY, 'scroll') === 'tiles' ? 'tiles' : 'scroll'));
  const win = useWindowDimensions();
  const [editing, setEditing] = useState(false);
  const [acct, setAcct] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [, bump] = useState(0);
  const pending = usePendingDrops();

  const load = useCallback(async () => {
    await ensureCore();
    let id: string | null = null;
    if (isOther) {
      const p = await fetchProfileByHandle(requested);
      setOther(p);
      if (!p) return setDrops([]);
      id = p.id;
    } else {
      const [p, local] = await Promise.all([fetchMyProfile(), getLocalAvatar()]);
      setMe(p);
      setAvatar((p && p.avatar_url) || local);
      id = VoidAPI._uid();
    }
    if (!id) {
      // Signed out: the creators followed from reels still count.
      if (!isOther) setCounts({ following: localFollowingExtra(new Set()), followers: 0 });
      return setDrops([]);
    }
    // Counts for BOTH profiles. Your own read the local USER counters, which nothing
    // ever wrote, so your own profile always said 0 following / 0 followers.
    const [d, a, b] = await Promise.all([
      fetchDrops(id),
      VoidAPI._sb('/rest/v1/follows?follower_id=eq.' + id + '&select=followee_id&limit=1000', 'GET').catch(() => []),
      VoidAPI._sb('/rest/v1/follows?followee_id=eq.' + id + '&select=follower_id&limit=1000', 'GET').catch(() => []),
    ]);
    setDrops(d);
    // Your FOLLOWING also counts the reel creators followed from this device.
    const extra = isOther ? 0 : localFollowingExtra(new Set((a || []).map((r: any) => r.followee_id)));
    setCounts({ following: (a || []).length + extra, followers: (b || []).length });
  }, [isOther, requested]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load, isOther]),
  );
  useEffect(() => onDropPosted(() => load()), [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Own drops posted this session that the server list has not caught up with yet.
  const shownDrops = useMemo<Post[]>(() => {
    const list = drops || [];
    if (isOther) return list;
    const ids = new Set(list.map((x) => x.id));
    const extra = pending.filter((p) => !p._pending && !ids.has(p.id)) as unknown as Post[];
    return [...extra, ...list];
  }, [drops, pending, isOther]);

  const otherAuthor = other ? voidAuthor({ id: other.id, handle: other.handle, name: other.display_name }) : null;
  const otherBlocked = !!otherAuthor && moderation.isBlocked(otherAuthor);

  // Your own name is the server's display_name; the local one is set to the bare
  // handle when an account is adopted on a device.
  const name = isOther ? other?.display_name || other?.handle || requested : me?.display_name || user.name;
  const handle = isOther ? '@' + (other?.handle || requested) : user.handle;
  const bio = isOther ? '' : user.bio || 'signal in the noise';
  // Same order as the labels: DROPS, FOLLOWERS, FOLLOWING (followers and following were swapped).
  // ponytail: DROPS caps at fetchDrops' limit=40; a count=exact HEAD request if that matters.
  const stats = [shownDrops.length, counts?.followers ?? 0, counts?.following ?? 0];

  const share = () => {
    const url = PROFILE_SHARE_BASE + '#' + (handle || '@void');
    Share.share({ title: name || 'The Void', message: url, url }).catch(() => {});
  };
  const message = () => {
    if (!other) return;
    if (otherBlocked) return voidToast('YOU BLOCKED THIS ACCOUNT');
    openDmWith(other.id);
  };

  const dim = themeName === 'void' ? '#8d7cc0' : colors.dim;
  const statDivider = isLight ? colors.hairline : 'rgba(255,255,255,0.08)';
  // Each list is fetched the first time its tab is opened, not on mount: most
  // visits never leave DROPS, and these are two more round trips.
  const authorId = isOther ? (other && other.id) || null : VoidAPI._uid();
  useEffect(() => {
    let live = true;
    if (tab === 'hearted' && hearted === null) {
      fetchHearted(authorId).then((r) => { if (live) setHearted(r); });
    } else if (tab === 'replies' && replies === null) {
      fetchReplies(authorId).then((r) => { if (live) setReplies(r); });
    }
    return () => { live = false; };
  }, [tab, authorId, hearted, replies]);

  // JOINED and N NATIONS, from what the row already carries.
  const bannerUrl = (isOther ? (other as any)?.banner_url : (me as any)?.banner_url) || null;
  const joinedLabel = (() => {
    const raw = isOther ? (other as any)?.created_at : (me as any)?.created_at;
    const d = raw ? new Date(raw) : null;
    if (!d || isNaN(d.getTime())) return ''; // no date is no claim
    return 'JOINED ' + d.toLocaleString('en', { month: 'short' }).toUpperCase() + ' ' + d.getFullYear();
  })();
  // How many nations this account has actually dropped from.
  const nationCount = useMemo(() => new Set((drops || []).map((p) => p.iso || p.country).filter(Boolean)).size, [drops]);

  const listFor = (t: ProfTab): Post[] | null => (t === 'drops' ? shownDrops : t === 'hearted' ? hearted : replies);
  const current = listFor(tab);
  const tiles = layout === 'tiles';
  // Three across, inside the same 10px gutter the cards sit in.
  const tileSize = Math.floor((win.width - 48 - 6) / 3);

  const header =
    isOther && other === null ? (
      <View style={st.monument}>
        <Empty text="NO SUCH ACCOUNT" />
      </View>
    ) : (
      <View style={st.monument}>
        {/* THE BANNER SITS BEHIND THE HEADER AND THE AVATAR ROW.
            Absolutely positioned so nothing above it has to move or change:
            it is a backdrop, not a row in the stack. The gradient over it is
            what keeps the handle and the stats readable on any photo. */}
        {/* Only when there IS one. Painting the placeholder regardless left a flat
            purple slab cutting across the avatar - a banner's backdrop with no
            banner in it, which reads as a rendering fault rather than a design. */}
        {bannerUrl ? (
          <View pointerEvents="none" style={st.banner}>
            <Image source={{ uri: bannerUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <LinearGradient
              colors={['rgba(4,2,12,0.78)', 'rgba(4,2,12,0.68)', 'rgba(4,2,12,0.85)']}
              style={StyleSheet.absoluteFill}
            />
          </View>
        ) : null}

        {/* The handle. Settings lives in the pinned bar above - one gear, not two:
            adding this row without taking that bar away put a second gear on the
            screen and the word PROFILE over the top of the handle. */}
        <View style={st.headRow}>
          <VText style={{ flex: 1, fontFamily: FONTS.mono, fontSize: 10, letterSpacing: em(10, 0.14), color: colors.gold }}>
            {handle}
            {otherBlocked ? ' · BLOCKED' : ''}
          </VText>
        </View>

        <View style={st.idRow}>
          <View style={st.avRing}>
            <ProfileAvatar name={name} url={isOther ? other?.avatar_url : avatar} size={108} own={!isOther} uid={isOther ? other?.id : VoidAPI._uid()} />
          </View>
          <View style={st.statsRow}>
            {(['DROPS', 'FOLLOWERS', 'FOLLOWING'] as const).map((lbl, i) => (
              <Pressable
                key={lbl}
                disabled={i === 0}
                onPress={() => setFollowList(i === 1 ? 'followers' : 'following')}
                accessibilityRole={i === 0 ? undefined : 'button'}
                style={({ pressed }) => [st.stat, { opacity: pressed ? 0.72 : 1 }]}
              >
                <VText style={{ fontFamily: FONTS.sansExtraBold, fontSize: 22, color: colors.white }}>{fmt(stats[i])}</VText>
                <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.14), color: '#8d7cc0', marginTop: 3 }}>{lbl}</VText>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Name, bio, and the two lines that say how long and how far. */}
        <VText style={{ fontFamily: FONTS.sansBold, fontSize: 19, color: colors.white, marginTop: 14 }}>{name}</VText>
        {bio ? <VText style={{ fontFamily: FONTS.sans, fontSize: 13.5, color: '#c9bfe8', marginTop: 5 }}>{bio}</VText> : null}
        {/* The row only exists if there is something true to put in it. A bare
            word JOINED with no date is worse than no line at all. */}
        {joinedLabel || nationCount ? (
          <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.16), color: '#6a58a0', marginTop: 8 }}>
            {joinedLabel}
            {joinedLabel && nationCount ? '  ·  ' : ''}
            {nationCount ? nationCount + ' NATIONS' : ''}
          </VText>
        ) : null}

        {/* Two equal buttons, as the notes have them - not one wide and one square. */}
        <View style={st.actions}>
          <Pressable
            onPress={isOther ? message : () => setEditing(true)}
            style={({ pressed }) => [st.act, { opacity: pressed ? 0.8 : 1 }]}
          >
            <VText style={{ fontFamily: FONTS.sansBold, fontSize: 12.5, color: colors.white }}>{isOther ? 'Message' : 'Edit profile'}</VText>
          </Pressable>
          <Pressable accessibilityLabel="Share profile" onPress={share} style={({ pressed }) => [st.act, { opacity: pressed ? 0.8 : 1 }]}>
            <VText style={{ fontFamily: FONTS.sansBold, fontSize: 12.5, color: colors.white }}>Share profile</VText>
          </Pressable>
        </View>

        <View style={st.tabs}>
          {(['drops', 'hearted', 'replies'] as const).map((t) => {
            const on = tab === t;
            return (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                style={[st.tab, { borderBottomColor: on ? 'rgba(201,168,76,0.6)' : 'transparent' }]}
              >
                <VText style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: em(8.5, 0.18), color: on ? colors.white : colors.navDim }}>{t.toUpperCase()}</VText>
              </Pressable>
            );
          })}
          <View style={{ flex: 1 }} />
          {/* Grid / list as a pair, the lit one gold (6p-f). Their own row: st.tabs
              spaces its children 26 apart, the pair sits 4 apart. */}
          <View style={st.layoutPair}>
            {(['tiles', 'scroll'] as const).map((l) => {
              const on = layout === l;
              return (
                <Pressable
                  key={l}
                  onPress={() => {
                    setLayout(l);
                    writeJSON(TILE_KEY, l);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={l === 'tiles' ? 'Show drops as a grid' : 'Show drops as a list'}
                  hitSlop={6}
                  style={[st.layoutBtn, { backgroundColor: on ? 'rgba(201,168,76,0.16)' : 'transparent' }]}
                >
                  <Icon name={l === 'tiles' ? 'grid' : 'rows'} size={13} strokeWidth={2} color={on ? '#c9a84c' : '#5c4d8a'} />
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={{ height: tiles ? 12 : 20 }} />
      </View>
    );



  return (
    <View style={[st.fill, { backgroundColor: colors.bg }]}>
      {themeName === 'void' ? <RadialFill spec={PROF_GLOW} /> : colors.bgRadial ? <RadialFill spec={colors.bgRadial} /> : null}

      {/* .prof-top — pinned bar (the web's sticky row) */}
      <View style={[st.top, { paddingTop: 18 + insets.top, backgroundColor: themeName === 'void' ? '#120830' : colors.bg }]}>
        {isOther ? (
          <Pressable accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace(ROUTES.void as any))} hitSlop={8} style={st.gear}>
            <Icon name="back" size={17} color={dim} />
          </Pressable>
        ) : null}
        <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.3), color: colors.navDim, marginRight: 'auto' }}>PROFILE</VText>
        {isOther ? (
          other ? (
            <Pressable accessibilityLabel="More" onPress={() => setAcct(true)} hitSlop={8} style={st.gear}>
              <MiniIcon name="more" size={17} color={dim} />
            </Pressable>
          ) : null
        ) : (
          <Pressable accessibilityLabel="Settings" onPress={() => router.push(ROUTES.settings as any)} hitSlop={8} style={st.gear}>
            <Icon name="gear" size={17} color={dim} />
          </Pressable>
        )}
      </View>

      <FlatList
        style={st.fill}
        // numColumns cannot change on a live FlatList, so the layout is part of
        // the key: switching rebuilds the list rather than throwing.
        key={tiles ? 'tiles' : 'scroll'}
        numColumns={tiles ? 3 : 1}
        columnWrapperStyle={tiles ? st.tileRow : undefined}
        data={!(isOther && other === null) && current ? current : []}
        keyExtractor={(p) => p.id}
        // The same window the void feed uses (VoidFeedScreen.tsx). Without it this
        // list keeps every card it has scrolled past mounted, with their decoded
        // images and their video players, and nothing here ever unmounts.
        // removeClippedSubviews is deliberately NOT set: on Android it misplaces
        // cells under a tall ListHeaderComponent, and this header is the whole
        // profile monument. The window is the part that matters.
        windowSize={3}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        updateCellsBatchingPeriod={60}
        renderItem={({ item, index }) =>
          tiles ? (
            <ProfileTile post={item} size={tileSize} onPress={() => (tab === 'replies' ? openProfileReply : openProfilePost)(item.id, item)} />
          ) : (
            <PostCard post={item} index={index} surface="profile" ownerUid={authorId} onOpenThread={tab === 'replies' ? openProfileReply : openProfilePost} />
          )
        }
        viewabilityConfigCallbackPairs={viewability}
        ListHeaderComponent={header}
        ListEmptyComponent={
          (isOther && other === null) || current === null ? null : (
            <Empty
              text={
                tab === 'drops'
                  ? 'NO DROPS YET · JOIN THE THREAD'
                  : tab === 'hearted'
                    ? 'NOTHING HEARTED YET'
                    : 'NO REPLIES YET'
              }
            />
          )
        }
        contentContainerStyle={{ paddingBottom: isOther ? 24 + insets.bottom : navSpace + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.gold} />}
      />

      <ModerationHost />
      {!isOther ? (
        <EditProfileSheet
          visible={editing}
          onClose={() => setEditing(false)}
          avatarUrl={avatar}
          onSaved={() => {
            load();
            bump((n) => n + 1);
          }}
        />
      ) : null}
      <FollowListSheet kind={followList} uid={authorId} own={!isOther} onClose={() => setFollowList(null)} />
      {isOther ? <AccountSheet visible={acct} author={otherAuthor} onClose={() => setAcct(false)} onChanged={() => bump((n) => n + 1)} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  top: { paddingHorizontal: 22, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10, overflow: 'hidden', zIndex: 20 },
  gear: { width: 26, height: 26, marginRight: -4, alignItems: 'center', justifyContent: 'center' },
  monument: { paddingHorizontal: 24 },
  id: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingTop: 22 },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: 22 },
  stat: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  divider: { position: 'absolute', left: 0, top: '50%', marginTop: -10, width: 1, height: 20 },
  actions: { flexDirection: 'row', alignItems: 'stretch', gap: 10, marginTop: 20 },
  edit: { flex: 1, padding: 11, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  share: { width: 46, minHeight: 36, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  banner: { position: 'absolute', top: 0, left: 12, right: 12, height: 190, borderRadius: 18, overflow: 'hidden', backgroundColor: '#120830' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 2, paddingBottom: 16 },
  gearBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  // 0 0 0 2px bg then 0 0 0 4px gold: a dark gap, then the ring.
  // borderWidth, not boxShadow: the two-stop shadow drew as one thin gold circle
  // sitting well clear of the avatar, which looked like a mistake. A real border
  // hugs the image, and the dark gap is the padding inside it.
  avRing: { padding: 2, borderRadius: 60, borderWidth: 2, borderColor: '#c9a84c', backgroundColor: '#04020c' },
  statsRow: { flex: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  act: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  // 6p-f grid: 3 across, 3px gaps, inside the monument's 24px gutter.
  tileRow: { paddingHorizontal: 24, gap: 3, marginBottom: 3 },
  tile: { overflow: 'hidden', borderRadius: 5, backgroundColor: '#0d0820' },
  tileText: { ...StyleSheet.absoluteFill, paddingTop: 10, paddingHorizontal: 9, paddingBottom: 16, fontFamily: FONTS.serifItalic, fontSize: 10.5, lineHeight: 14, color: '#c9bfe8' },
  tileVoice: { ...StyleSheet.absoluteFill, justifyContent: 'center', gap: 8, paddingTop: 10, paddingHorizontal: 9, paddingBottom: 16 },
  tileWave: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 28 },
  tileBar: { flex: 1, borderRadius: 2 },
  tileVoicePlay: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#1a1030', alignItems: 'center', justifyContent: 'center' },
  tileClipWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  tileClip: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(4,2,12,0.7)', boxShadow: '0px 0px 0px 1px rgba(201,168,76,0.6)', alignItems: 'center', justifyContent: 'center' },
  // Its drop-shadow is ShadowedIcon's offset copy, not a boxShadow on this box.
  tileGlyph: { position: 'absolute', top: 6, right: 6 },
  glyphShadow: { position: 'absolute', top: 1, left: 0 },
  // 7px red dot with its 2px dark ring OUTSIDE it (the mock's box-shadow 0 0 0 2px):
  // an 11px ring with the dot centred, so the ring never eats the red.
  tileLive: { position: 'absolute', top: 5, left: 5, width: 11, height: 11, borderRadius: 5.5, backgroundColor: 'rgba(4,2,12,0.6)', alignItems: 'center', justifyContent: 'center' },
  tileLiveDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#ef4444' },
  tileFoot: { position: 'absolute', left: 6, right: 6, bottom: 5, flexDirection: 'row', alignItems: 'center' },
  tileFootText: { fontFamily: FONTS.mono, fontSize: 6, letterSpacing: em(6, 0.1), color: '#f4f0ff', textShadowColor: '#000', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } },
  layoutPair: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8 },
  layoutBtn: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', gap: 26, paddingTop: 26 },
  tab: { paddingBottom: 9, borderBottomWidth: 1 },
  pane: { paddingTop: 0, paddingHorizontal: 24 },
});
