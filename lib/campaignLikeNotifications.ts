import { createDealNotification } from '@/lib/firestore/notifications';
import { resolveActorAvatarUrl, upsertPublicProfile } from '@/lib/firestore/publicProfiles';
import { resolveDeveloperNotificationUserId } from '@/lib/resolveDeveloperUserId';
import { isRemotePhotoUrl } from '@/lib/profilePhoto';

export async function notifyCampaignLiked(input: {
  developerId: string;
  campaignId: string;
  campaignName: string;
  influencerName: string;
  likerId: string;
  influencerPhotoUrl?: string;
  thumbnailUrl?: string;
}): Promise<void> {
  const { developerId, campaignId, campaignName, influencerName, likerId } = input;

  const recipientUserId = await resolveDeveloperNotificationUserId(developerId, campaignId);
  if (!recipientUserId || recipientUserId === likerId) return;

  const displayName = influencerName.trim() || 'An influencer';

  await upsertPublicProfile(likerId, {
    displayName,
    photoUrl: isRemotePhotoUrl(input.influencerPhotoUrl) ? input.influencerPhotoUrl : undefined,
  });

  const actorPhotoUrl = await resolveActorAvatarUrl(
    likerId,
    displayName,
    input.influencerPhotoUrl,
  );

  await createDealNotification({
    userId: recipientUserId,
    type: 'campaign_liked',
    dealId: campaignId,
    title: 'New like on your video',
    body: `${displayName} liked your ${campaignName} video`,
    actorId: likerId,
    actorName: displayName,
    actorPhotoUrl,
    thumbnailUrl: input.thumbnailUrl,
  });
}
