const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';

const USER_FIELDS = [
  'open_id',
  'union_id',
  'avatar_url',
  'display_name',
  'username',
  'bio_description',
  'profile_deep_link',
  'is_verified',
  'follower_count',
  'following_count',
  'likes_count',
  'video_count',
].join(',');

function getTikTokCredentials() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();

  if (!clientKey || !clientSecret) {
    throw new Error('TikTok OAuth is not configured on the server.');
  }

  return { clientKey, clientSecret };
}

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      payload?.error_description ||
      payload?.message ||
      payload?.data?.description ||
      payload?.error?.message ||
      `TikTok request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

export async function exchangeTikTokAuthorizationCode({ code, redirectUri, codeVerifier }) {
  const { clientKey, clientSecret } = getTikTokCredentials();

  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = await parseJsonResponse(response);
  const data = payload?.data ?? payload;

  if (!data?.access_token) {
    throw new Error('TikTok did not return an access token.');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    openId: data.open_id ?? null,
    expiresIn: data.expires_in ?? null,
    scope: data.scope ?? '',
  };
}

export async function fetchTikTokUserProfile(accessToken) {
  const url = `${USER_INFO_URL}?fields=${encodeURIComponent(USER_FIELDS)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await parseJsonResponse(response);
  const user = payload?.data?.user;

  if (!user) {
    throw new Error('TikTok did not return profile information.');
  }

  const username = String(user.username ?? '').trim();
  const handle = username ? (username.startsWith('@') ? username : `@${username}`) : '';
  const profileUrl =
    String(user.profile_deep_link ?? '').trim() ||
    (username ? `https://www.tiktok.com/@${username.replace(/^@/, '')}` : '');

  return {
    openId: String(user.open_id ?? ''),
    unionId: user.union_id ? String(user.union_id) : undefined,
    username,
    displayName: String(user.display_name ?? '').trim(),
    avatarUrl: String(user.avatar_url ?? '').trim() || undefined,
    bio: String(user.bio_description ?? '').trim() || undefined,
    profileUrl: profileUrl || undefined,
    isVerified: Boolean(user.is_verified),
    followerCount: Number(user.follower_count ?? 0),
    followingCount: Number(user.following_count ?? 0),
    likesCount: Number(user.likes_count ?? 0),
    videoCount: Number(user.video_count ?? 0),
  };
}

export function buildTikTokPlatformLink(profile) {
  const handle =
    profile.username.trim().length > 0
      ? profile.username.startsWith('@')
        ? profile.username
        : `@${profile.username}`
      : profile.displayName
        ? `@${profile.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '')}`
        : '@creator';

  return {
    platform: 'TikTok',
    handle,
    followers: Math.max(0, profile.followerCount ?? 0),
    profileUrl: profile.profileUrl,
  };
}
