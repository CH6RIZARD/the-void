// PROFILE v3 (patch3 §2) — #screen-profile, CSS 1:1 from void2-final.html 486-586 + 1155-1160.
//   <ProfileScreen />                 own profile (tab)
//   <ProfileScreen handle="alice" />  other user (/u/[handle]): MESSAGE + block / report
// With no prop, a `handle` route param is honoured, so A's /u/[handle] route can render it bare.
// DROPS render as <PostCard surface="profile"> in a FlatList with usePostViewability('profile')
// and one <ModerationHost/> for the ⋯ sheets.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
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
import { ModerationHost, PostCard, usePostViewability } from '../feed';
import { ensureCore, useIdentity } from '../auth/coreBridge';
import { stripHandle } from '../auth/handles';
import { onDropPosted } from '../composer/drop';
import { usePendingDrops } from '../composer/dropStore';
import { openDmWith } from '../messages/MessagesScreen';
import { MiniIcon } from '../settings/vmod';
import { AccountSheet, voidAuthor } from './AccountSheet';
import { EditProfileSheet } from './EditProfileSheet';
import { ProfileAvatar } from './ProfileAvatar';
import { fetchDrops, fetchHearted, fetchMyProfile, fetchProfileByHandle, fetchReplies, getLocalAvatar, type ProfileRow } from './profileApi';

/** --prof-glow (VOID): radial-gradient(110% 45% at 50% 0%,#120830 0%,#04020c 58%) */
const PROF_GLOW: RadialSpec = { rx: 110, ry: 45, cx: 50, cy: 0, stops: [{ color: '#120830', offset: 0 }, { color: '#04020c', offset: 0.58 }] };
export const PROFILE_SHARE_BASE = 'https://void-app-d35c.pages.dev/';

function Empty({ text, pad = 30 }: { text: string; pad?: number }) {
  const { colors } = useTheme();
  return <VText align="center" style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.12), color: colors.muted, padding: pad }}>{text}</VText>;
}

const TILE_KEY = 'void.profile.layout';
type ProfTab = 'drops' | 'hearted' | 'replies';
type ProfLayout = 'scroll' | 'tiles';

/**
 * One square of the tile grid.
 *
 * Every drop kind has to read at a third of the screen width, where there is no
 * room for a card. Media fills the square; a clip and a gallery say which they
 * are with a corner glyph rather than a label; a voice drop draws its waveform,
 * because a voice post with its media hidden is otherwise indistinguishable from
 * an empty one; and a text drop shows its first lines, which is all it has.
 */
const ProfileTile = React.memo(function ProfileTile({ post, size, onPress }: { post: Post; size: number; onPress: () => void }) {
  const { colors } = useTheme();
  const img = post._img || (post._imgs && post._imgs[0]) || null;
  const isVoice = post.style === 'audio' || !!post._audio;
  const isClip = post.style === 'video' || !!post._video;
  const isGallery = post.style === 'carousel' || (post._imgs ? post._imgs.length > 1 : false);
  const isLive = post.style === 'link_live';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={post.body ? post.body.slice(0, 60) : 'Drop'}
      style={[st.tile, { width: size, height: size, borderColor: colors.hairline }]}
    >
      {img ? (
        <Image source={{ uri: img }} style={st.tileImg} resizeMode="cover" />
      ) : isVoice ? (
        <View style={st.tileVoice}>
          {/* Deterministic per post, so a drop keeps the same waveform between
              renders and between the two layouts. */}
          {Array.from({ length: 13 }, (_, i) => {
            const seed = (post.id.charCodeAt(i % post.id.length) * 31 + i * 17) % 100;
            return <View key={i} style={[st.tileBar, { height: 6 + (seed / 100) * 26 }]} />;
          })}
        </View>
      ) : (
        <View style={st.tileText}>
          <VText numberOfLines={3} style={{ fontFamily: FONTS.sans, fontSize: 11, lineHeight: 15, color: colors.muted }}>
            {(post.body || '').trim() || '—'}
          </VText>
        </View>
      )}
      {isLive ? (
        <View style={st.tilePill}>
          <VText style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.16), color: '#fff' }}>LIVE</VText>
        </View>
      ) : isClip ? (
        <View style={st.tileGlyph}><Icon name="play" size={13} color="#fff" /></View>
      ) : isGallery ? (
        <View style={st.tileGlyph}><Icon name="shapes" size={12} color="#fff" /></View>
      ) : null}
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
  const [avatar, setAvatar] = useState<string | null>(null);
  const [drops, setDrops] = useState<Post[] | null>(null);
  const [counts, setCounts] = useState<{ following: number; followers: number } | null>(null);
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
    if (isOther) {
      const p = await fetchProfileByHandle(requested);
      setOther(p);
      if (p) {
        setDrops(await fetchDrops(p.id));
        const [a, b] = await Promise.all([
          VoidAPI._sb('/rest/v1/follows?follower_id=eq.' + p.id + '&select=followee_id&limit=1000', 'GET').catch(() => []),
          VoidAPI._sb('/rest/v1/follows?followee_id=eq.' + p.id + '&select=follower_id&limit=1000', 'GET').catch(() => []),
        ]);
        setCounts({ following: (a || []).length, followers: (b || []).length });
      } else setDrops([]);
    } else {
      const [p, local] = await Promise.all([fetchMyProfile(), getLocalAvatar()]);
      setAvatar((p && p.avatar_url) || local);
      setDrops(await fetchDrops(VoidAPI._uid()));
    }
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

  const name = isOther ? other?.display_name || other?.handle || requested : user.name;
  const handle = isOther ? '@' + (other?.handle || requested) : user.handle;
  const bio = isOther ? '' : user.bio || 'signal in the noise';
  const stats = isOther ? [shownDrops.length, counts?.following ?? 0, counts?.followers ?? 0] : [user.posts || 0, user.following || 0, user.followers || 0];

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
  const authorId = isOther ? (other && other.id) || null : user.id || null;
  useEffect(() => {
    let live = true;
    if (tab === 'hearted' && hearted === null) {
      fetchHearted(authorId).then((r) => { if (live) setHearted(r); });
    } else if (tab === 'replies' && replies === null) {
      fetchReplies(authorId).then((r) => { if (live) setReplies(r); });
    }
    return () => { live = false; };
  }, [tab, authorId, hearted, replies]);

  const showDrops = tab === 'drops';
  const listFor = (t: ProfTab): Post[] | null => (t === 'drops' ? shownDrops : t === 'hearted' ? hearted : replies);
  const current = listFor(tab);
  const tiles = layout === 'tiles';
  // Three across, inside the same 10px gutter the cards sit in.
  const tileSize = Math.floor((win.width - 20 - 6) / 3);

  const header =
    isOther && other === null ? (
      <View style={st.monument}>
        <Empty text="NO SUCH ACCOUNT" />
      </View>
    ) : (
      <View style={st.monument}>
        <View style={st.id}>
          <ProfileAvatar name={name} url={isOther ? other?.avatar_url : avatar} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <VText style={{ fontFamily: FONTS.serif, fontSize: 25, lineHeight: 25 * 1.1, color: colors.white }}>{name}</VText>
            <VText style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: em(9.5, 0.14), color: colors.gold, marginTop: 4 }}>
              {handle}
              {otherBlocked ? ' · BLOCKED' : ''}
            </VText>
            {bio ? <VText style={{ fontFamily: FONTS.serifItalic, fontSize: 13.5, color: dim, marginTop: 7 }}>{bio}</VText> : null}
          </View>
        </View>

        <View style={st.stats}>
          {(['DROPS', 'FOLLOWING', 'VOICES'] as const).map((lbl, i) => (
            <View key={lbl} style={st.stat}>
              {i > 0 ? <View style={[st.divider, { backgroundColor: statDivider }]} /> : null}
              <VText style={{ fontFamily: FONTS.sansBold, fontSize: 15, color: colors.white }}>{stats[i]}</VText>
              <VText style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.18), color: colors.navDim, marginTop: 3 }}>{lbl}</VText>
            </View>
          ))}
        </View>

        <View style={st.actions}>
          <Pressable
            onPress={isOther ? message : () => setEditing(true)}
            style={({ pressed }) => [st.edit, { backgroundColor: isLight ? colors.white : 'rgba(244,240,255,0.94)', opacity: pressed ? 0.9 : 1 }]}
          >
            <VText style={{ fontFamily: FONTS.sansBold, fontSize: 11, letterSpacing: em(11, 0.08), color: isLight ? colors.card : '#04020c' }}>{isOther ? 'MESSAGE' : 'EDIT PROFILE'}</VText>
          </Pressable>
          <Pressable accessibilityLabel="Share profile" onPress={share} style={[st.share, { boxShadow: `inset 0px 0px 0px 1px ${isLight ? colors.hairline : 'rgba(255,255,255,0.12)'}` }]}>
            <Icon name="share" size={14} color={dim} />
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
          <Pressable
            onPress={() => {
              const next: ProfLayout = layout === 'tiles' ? 'scroll' : 'tiles';
              setLayout(next);
              writeJSON(TILE_KEY, next);
            }}
            accessibilityRole="button"
            accessibilityLabel={layout === 'tiles' ? 'Show drops as a list' : 'Show drops as a grid'}
            hitSlop={10}
            style={st.layoutBtn}
          >
            <Icon name={layout === 'tiles' ? 'dms' : 'shapes'} size={14} color={colors.navDim} />
          </Pressable>
        </View>
        <View style={{ height: 20 }} />
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
            <ProfileTile post={item} size={tileSize} onPress={() => router.push(ROUTES.thread(item.id) as any)} />
          ) : (
            <PostCard post={item} index={index} surface="profile" />
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
  tile: { margin: 1, overflow: 'hidden', borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.03)' },
  tileImg: { width: '100%', height: '100%' },
  tileText: { flex: 1, padding: 8, justifyContent: 'center' },
  tileVoice: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  tileBar: { width: 3, borderRadius: 2, backgroundColor: '#7a5cc4' },
  tileGlyph: { position: 'absolute', top: 5, right: 5 },
  tilePill: { position: 'absolute', top: 5, left: 5, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3, backgroundColor: 'rgba(210,60,60,0.9)' },
  layoutBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  tabs: { flexDirection: 'row', gap: 26, paddingTop: 26 },
  tab: { paddingBottom: 9, borderBottomWidth: 1 },
  pane: { paddingTop: 0, paddingHorizontal: 24 },
});
