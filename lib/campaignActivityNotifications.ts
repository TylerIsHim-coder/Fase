import { createDealNotification, type DealNotificationType } from '@/lib/firestore/notifications';
import {
  resolveActorAvatarUrl,
  upsertPublicProfile,
} from '@/lib/firestore/publicProfiles';
import { resolveDeveloperNotificationUserId } from '@/lib/resolveDeveloperUserId';
import { isRemotePhotoUrl } from '@/lib/profilePhoto';

export const DEVELOPER_ACTIVITY_TYPES: DealNotificationType[] = [
  'campaign_liked',
  'campaign_commented',
  'profile_viewed',
  'new_follower',
];

export function isDeveloperActivityNotification(type: DealNotificationType): boolean {
  return DEVELOPER_ACTIVITY_TYPES.includes(type);
}

export async function notifyCampaignCommented(input: {
  developerId: string;
  campaignId: string;
  campaignName: string;
  thumbnailUrl?: string;
  commenterId: string;
  commenterName: string;
  commenterPhotoUrl?: string;
  commentPreview: string;
}): Promise<void> {
  const { developerId, campaignId, commenterId } = input;

  const recipientUserId = await resolveDeveloperNotificationUserId(developerId, campaignId);
  if (!recipientUserId || recipientUserId === commenterId) return;

  const name = input.commenterName.trim() || 'Someone';
  const preview = input.commentPreview.trim();

  await upsertPublicProfile(commenterId, {
    displayName: name,
    photoUrl: isRemotePhotoUrl(input.commenterPhotoUrl) ? input.commenterPhotoUrl : undefined,
  });

  const actorPhotoUrl = await resolveActorAvatarUrl(
    commenterId,
    name,
    input.commenterPhotoUrl,
  );

  await createDealNotification({
    userId: recipientUserId,
    type: 'campaign_commented',
    dealId: campaignId,
    title: 'New comment',
    body: preview
      ? `${name} commented: "${preview}"`
      : `${name} commented on your ${input.campaignName} video`,
    actorId: commenterId,
    actorName: name,
    actorPhotoUrl,
    thumbnailUrl: input.thumbnailUrl,
  });
}

export async function notifyProfileViewed(input: {
  developerId: string;
  viewerId: string;
  viewerName: string;
  viewerPhotoUrl?: string;
}): Promise<void> {
  const { developerId, viewerId } = input;
  if (!developerId || developerId === viewerId) return;

  const name = input.viewerName.trim() || 'Someone';

  await upsertPublicProfile(viewerId, {
    displayName: name,
    photoUrl: isRemotePhotoUrl(input.viewerPhotoUrl) ? input.viewerPhotoUrl : undefined,
  });

  const actorPhotoUrl = await resolveActorAvatarUrl(viewerId, name, input.viewerPhotoUrl);

  await createDealNotification({
    userId: developerId,
    type: 'profile_viewed',
    dealId: viewerId,
    title: 'Profile view',
    body: `${name} viewed your profile`,
    actorId: viewerId,
    actorName: name,
    actorPhotoUrl,
  });
}

export async function notifyNewFollower(input: {
  developerId: string;
  followerId: string;
  followerName: string;
  followerPhotoUrl?: string;
}): Promise<void> {
  const { developerId, followerId } = input;
  if (!developerId || developerId === followerId) return;

  const name = input.followerName.trim() || 'Someone';

  await upsertPublicProfile(followerId, {
    displayName: name,
    photoUrl: isRemotePhotoUrl(input.followerPhotoUrl) ? input.followerPhotoUrl : undefined,
  });

  const actorPhotoUrl = await resolveActorAvatarUrl(
    followerId,
    name,
    input.followerPhotoUrl,
  );

  await createDealNotification({
    userId: developerId,
    type: 'new_follower',
    dealId: followerId,
    title: 'New follower',
    body: `${name} started following you`,
    actorId: followerId,
    actorName: name,
    actorPhotoUrl,
  });
}
