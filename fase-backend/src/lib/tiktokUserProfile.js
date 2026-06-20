import { initFirebase } from '../config/firebase.js';

import { buildTikTokPlatformLink } from './tiktok.js';

function mergePlatformLinks(existingLinks, tiktokLink) {
  const links = Array.isArray(existingLinks) ? [...existingLinks] : [];
  const index = links.findIndex((link) => link?.platform === 'TikTok');

  if (index >= 0) {
    links[index] = { ...links[index], ...tiktokLink };
  } else {
    links.unshift(tiktokLink);
  }

  return links;
}

export async function saveTikTokConnectionForUser(userId, profile, tokenMeta) {
  const firebase = initFirebase();
  if (!firebase) {
    throw new Error('Firebase is not configured');
  }

  const connectedAt = new Date().toISOString();
  const tiktokConnection = {
    openId: profile.openId,
    unionId: profile.unionId,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    bio: profile.bio,
    profileUrl: profile.profileUrl,
    isVerified: profile.isVerified,
    followerCount: profile.followerCount,
    followingCount: profile.followingCount,
    likesCount: profile.likesCount,
    videoCount: profile.videoCount,
    connectedAt,
    scope: tokenMeta.scope,
    tokenExpiresIn: tokenMeta.expiresIn,
  };

  const tiktokPlatformLink = buildTikTokPlatformLink(profile);
  const userRef = firebase.firestore().collection('users').doc(userId);
  const snapshot = await userRef.get();
  const existing = snapshot.exists ? snapshot.data() : {};
  const influencer = existing.influencer ?? {};
  const platformLinks = mergePlatformLinks(influencer.platformLinks, tiktokPlatformLink);
  const platforms = Array.from(
    new Set([...(Array.isArray(influencer.platforms) ? influencer.platforms : []), 'TikTok']),
  );

  const nextInfluencer = {
    ...influencer,
    platforms,
    platformLinks,
    tiktokConnection,
    ...(profile.bio && !influencer.bio ? { bio: profile.bio } : {}),
  };

  await userRef.set(
    {
      influencer: nextInfluencer,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    tiktok: tiktokConnection,
    platformLink: tiktokPlatformLink,
    influencer: nextInfluencer,
  };
}
