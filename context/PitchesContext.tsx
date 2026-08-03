import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { Alert } from 'react-native';

import { formatCurrency } from '@/constants/mockData';
import { useAuth } from '@/context/AuthContext';
import { useCampaigns } from '@/context/CampaignsContext';
import { ApiError } from '@/lib/api/client';
import { cancelDealPayment, autoReleaseDealPayout, releaseDealPayout } from '@/lib/api/payments';
import { isApiConfigured } from '@/lib/api/config';
import { isDealEligibleForAutoPostRelease, POST_CONFIRMATION_AUTO_RELEASE_DAYS } from '@/lib/dealAutoRelease';
import { clipToPendingDeal } from '@/lib/clipToPendingDeal';
import { creatorBookingToPendingDeal } from '@/lib/creatorBookingToPendingDeal';
import { applyDealDeclinedState, filterActiveDeals, type DealDeclinedBy } from '@/lib/dealDecline';
import { notifyDealEvent } from '@/lib/dealNotifications';
import {
  dealNegotiationTimestamp,
  isDealPaidSnapshot,
  mergeCloudDealsWithLocal,
  normalizeStoredDeals,
  pickPreferredDeal,
  shouldApplyPitchLock,
} from '@/lib/dealHydration';
import {
  alertAlreadyPitchedCampaign,
  getDealInProgressForCampaign,
  getExistingDealForCampaign,
  isDealInProgress,
} from '@/lib/dealInProgress';
import {
  applyDealCashedOutState,
  applyDealCompletedState,
  applyDealPayoutReleasedState,
  applyPaymentSecuredState,
  isDealCashedOut,
  isDealPaidByDeveloper,
  isDealPaymentSecured,
  isDealReadyForDeveloperPayment,
} from '@/lib/dealPayment';
import { applyProfileMetricsToDeal, fetchInfluencerMetricsMap } from '@/lib/enrichPitchMetrics';
import { deleteDeal, migrateLocalDealsToFirestore, subscribeUserDeals, upsertDeal } from '@/lib/firestore/deals';
import { appendChatMessage, ensureThreadForDeal } from '@/lib/firestore/threads';
import { runDeliveryVideoUpload } from '@/lib/deliveryVideoUpload';
import { isDealRateAgreed } from '@/lib/dealDelivery';
import { formatShippingAddress, isShippingComplete, shippingStatusAfterRateAgreed } from '@/lib/dealShipping';
import { getInfluencerDeals } from '@/lib/getInfluencerDeals';
import { getDealCampaignContext } from '@/lib/getDealCampaignContext';
import { buildPitchDealId, getCampaignIdFromDeal } from '@/lib/pitchDealId';
import {
  loadNegotiationLocks,
  saveNegotiationLocks,
} from '@/lib/negotiationLocksStorage';
import {
  dealBelongsToAccount,
  loadStoredPitches,
  saveStoredPitches,
} from '@/lib/pitchesStorage';
import { resolveDealDeveloperId, resolveDealsDeveloperIds } from '@/lib/resolveDealDeveloperId';
import { getDb } from '@/lib/firebase';
import type {
  AppClip,
  Campaign,
  CreatorBrowseProfile,
  Deal,
  InfluencerProfile,
  PitchStatus,
  PitchTabFilter,
  ShippingAddress,
} from '@/types';

interface PitchesContextValue {
  deals: Deal[];
  influencerDeals: Deal[];
  pitchedClipIds: Set<string>;
  isHydrated: boolean;
  submitPitch: (clip: AppClip, rate: number, influencer: InfluencerProfile) => void;
  submitBookingRequest: (
    creator: CreatorBrowseProfile,
    campaign: Campaign,
    developerId: string,
  ) => boolean;
  markDealCompleted: (dealId: string) => Promise<boolean>;
  submitCounterOffer: (dealId: string, amount: number) => boolean;
  acceptPitchOffer: (dealId: string) => boolean;
  acceptCounterOffer: (dealId: string) => boolean;
  requestDeveloperPitchesTab: (tab: PitchTabFilter) => void;
  consumeDeveloperPitchesTabIntent: () => PitchTabFilter | null;
  refreshDealsSnapshot: () => void;
  rejectCounterOffer: (dealId: string) => void;
  updatePitchStatus: (
    dealId: string,
    status: PitchStatus,
    paymentIntentId?: string,
  ) => Promise<{ deal?: Deal; persisted: boolean }>;
  deleteDealPermanently: (dealId: string) => Promise<boolean>;
  declinePitch: (dealId: string) => Promise<boolean>;
  declineDeal: (dealId: string) => Promise<boolean>;
  removeDeal: (dealId: string) => Promise<boolean>;
  markDealsCashedOut: (dealIds: string[]) => void;
  syncInfluencerAudienceMetrics: (influencerId: string, profile: InfluencerProfile) => void;
  getDealById: (id: string) => Deal | undefined;
  isPitched: (clipId: string) => boolean;
  hasDealInProgressForClip: (clipId: string) => boolean;
  submitDeliveryVideo: (dealId: string, localUri: string) => Promise<boolean>;
  approveDelivery: (dealId: string) => Promise<boolean>;
  syncDeliveryPendingReview: (
    dealId: string,
    input?: { videoUrl?: string; thumbnailUrl?: string },
  ) => Promise<boolean>;
  requestDeliveryChanges: (dealId: string, note?: string) => Promise<boolean>;
  submitShippingAddress: (dealId: string, address: ShippingAddress) => boolean;
  markProductShipped: (
    dealId: string,
    input?: { trackingNumber?: string; shippingCarrier?: string },
  ) => boolean;
  markProductReceived: (dealId: string) => boolean;
}

const PitchesContext = createContext<PitchesContextValue | null>(null);

async function enrichDealsWithMetrics(deals: Deal[]): Promise<Deal[]> {
  const influencerIds = [
    ...new Set(deals.map((deal) => deal.influencerId).filter(Boolean) as string[]),
  ];

  if (influencerIds.length === 0) return deals;

  try {
    const metricsByInfluencer = await fetchInfluencerMetricsMap(influencerIds);
    if (metricsByInfluencer.size === 0) return deals;

    return deals.map((deal) => {
      if (!deal.influencerId) return deal;
      const profile = metricsByInfluencer.get(deal.influencerId);
      if (!profile) return deal;
      return applyProfileMetricsToDeal(deal, profile);
    });
  } catch {
    return deals;
  }
}

function writeLocalDealsSnapshot(
  localSnapshotRef: MutableRefObject<Deal[]>,
  deals: Deal[],
  userId: string | null,
  ownedCampaignIds: string[],
) {
  const scoped = userId
    ? deals.filter((deal) => dealBelongsToAccount(deal, userId, ownedCampaignIds))
    : [];
  localSnapshotRef.current = scoped;
  if (userId) {
    void saveStoredPitches(scoped, userId);
  }
}

export function PitchesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { campaigns, deductCampaignBudget } = useCampaigns();
  const influencerId = user?.uid ?? null;
  const [deals, setDeals] = useState<Deal[]>([]);
  const [negotiationRevision, setNegotiationRevision] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);
  const migratedRef = useRef(false);
  const localSnapshotRef = useRef<Deal[]>([]);
  const paymentLocksRef = useRef<Map<string, Deal>>(new Map());
  const pitchLocksRef = useRef<Map<string, Deal>>(new Map());
  const withdrawnLocksRef = useRef<Map<string, Deal>>(new Map());
  const autoReleaseInFlightRef = useRef<Set<string>>(new Set());
  const developerPitchesTabIntentRef = useRef<PitchTabFilter | null>(null);
  const campaignsRef = useRef(campaigns);
  const dealsRef = useRef(deals);
  const lastHydratedUserRef = useRef<string | null>(null);
  const dealsUnsubscribeRef = useRef<(() => void) | null>(null);
  campaignsRef.current = campaigns;

  const ownedCampaignIds = useMemo(
    () =>
      campaigns
        .filter((campaign) => campaign.developerId === user?.uid)
        .map((campaign) => campaign.id),
    [campaigns, user?.uid],
  );

  const persistDeals = useCallback(
    (nextDeals: Deal[]) => {
      writeLocalDealsSnapshot(localSnapshotRef, nextDeals, influencerId, ownedCampaignIds);
    },
    [influencerId, ownedCampaignIds],
  );

  const requestDeveloperPitchesTab = useCallback((tab: PitchTabFilter) => {
    developerPitchesTabIntentRef.current = tab;
  }, []);

  const consumeDeveloperPitchesTabIntent = useCallback((): PitchTabFilter | null => {
    const tab = developerPitchesTabIntentRef.current;
    developerPitchesTabIntentRef.current = null;
    return tab;
  }, []);

  const bumpNegotiation = useCallback(() => {
    setNegotiationRevision((revision) => revision + 1);
  }, []);

  const persistNegotiationLocks = useCallback(() => {
    if (!influencerId) return;
    void saveNegotiationLocks(influencerId, pitchLocksRef.current);
  }, [influencerId]);

  const setPitchLock = useCallback(
    (dealId: string, deal: Deal) => {
      const locked: Deal = deal.negotiationUpdatedAt
        ? deal
        : { ...deal, negotiationUpdatedAt: new Date().toISOString() };
      pitchLocksRef.current.set(dealId, locked);
      persistNegotiationLocks();
      bumpNegotiation();
    },
    [bumpNegotiation, persistNegotiationLocks],
  );

  const releaseStalePitchLock = useCallback(
    (dealId: string) => {
      if (!pitchLocksRef.current.has(dealId)) return;
      pitchLocksRef.current.delete(dealId);
      persistNegotiationLocks();
      bumpNegotiation();
    },
    [bumpNegotiation, persistNegotiationLocks],
  );

  const resolveDealWithPitchLock = useCallback((deal: Deal): Deal => {
    const lock = pitchLocksRef.current.get(deal.id);
    if (!lock) return deal;

    const locked: Deal = lock.negotiationUpdatedAt
      ? lock
      : { ...lock, negotiationUpdatedAt: new Date().toISOString() };

    // Developer counter locks are optimistic; once Firestore has a newer accept, use cloud state.
    if (!shouldApplyPitchLock(deal, locked)) {
      return deal;
    }

    return pickPreferredDeal(deal, locked);
  }, []);

  const applyPitchLocksToDeals = useCallback(
    (source: Deal[]): Deal[] => {
      const merged = source.map((deal) => resolveDealWithPitchLock(deal));

      for (const [dealId, lock] of pitchLocksRef.current) {
        if (source.some((deal) => deal.id === dealId)) continue;
        merged.push(lock);
      }

      return merged;
    },
    [resolveDealWithPitchLock],
  );
  const clearPitchLock = useCallback(
    (dealId: string) => {
      releaseStalePitchLock(dealId);
    },
    [releaseStalePitchLock],
  );

  const visibleDeals = useMemo(
    () => filterActiveDeals(applyPitchLocksToDeals(deals)),
    [applyPitchLocksToDeals, deals, negotiationRevision],
  );

  useEffect(() => {
    let released = false;

    for (const deal of deals) {
      const lock = pitchLocksRef.current.get(deal.id);
      if (!lock) continue;
      if (!shouldApplyPitchLock(deal, lock)) {
        pitchLocksRef.current.delete(deal.id);
        released = true;
      }
    }

    if (!released) return;

    if (influencerId) {
      void saveNegotiationLocks(influencerId, pitchLocksRef.current);
    }
    bumpNegotiation();
  }, [bumpNegotiation, deals, influencerId, negotiationRevision]);

  dealsRef.current = visibleDeals;

  const refreshDealsSnapshot = useCallback(() => {
    setDeals((prev) => {
      const normalized = normalizeStoredDeals(prev);
      const unchanged =
        normalized.length === prev.length &&
        normalized.every((deal, index) => {
          const before = prev[index];
          return (
            before?.id === deal.id &&
            before?.status === deal.status &&
            before?.statusLabel === deal.statusLabel &&
            before?.counterOfferAmount === deal.counterOfferAmount &&
            before?.amount === deal.amount
          );
        });

      if (unchanged) return prev;

      persistDeals(normalized);
      return normalized;
    });
  }, [persistDeals]);

  const releaseConfirmedPaymentLocks = useCallback((cloudDeals: Deal[]) => {
    for (const deal of cloudDeals) {
      if (isDealCashedOut(deal)) {
        withdrawnLocksRef.current.delete(deal.id);
        paymentLocksRef.current.delete(deal.id);
        pitchLocksRef.current.delete(deal.id);
      } else if (isDealPaidSnapshot(deal)) {
        paymentLocksRef.current.delete(deal.id);
        pitchLocksRef.current.delete(deal.id);
      }
    }
  }, []);

  const releaseConfirmedPitchLocks = useCallback(
    (cloudDeals: Deal[]) => {
      let locksChanged = false;

      for (const deal of cloudDeals) {
        if (!pitchLocksRef.current.has(deal.id)) continue;

        const locked = pitchLocksRef.current.get(deal.id);
        if (!locked) continue;

        if (isDealPaidSnapshot(deal)) {
          pitchLocksRef.current.delete(deal.id);
          locksChanged = true;
          continue;
        }

        // Drop accept locks once delivery progresses or cloud is newer.
        if (
          isDealReadyForDeveloperPayment(deal) ||
          deal.deliveryStatus === 'pending_review' ||
          deal.deliveryStatus === 'approved' ||
          dealNegotiationTimestamp(deal) >= dealNegotiationTimestamp(locked)
        ) {
          pitchLocksRef.current.delete(deal.id);
          locksChanged = true;
        }
      }

      if (locksChanged) {
        persistNegotiationLocks();
        bumpNegotiation();
      }
    },
    [bumpNegotiation, persistNegotiationLocks],
  );

  const mergeDeals = useCallback(
    (localDeals: Deal[], cloudDeals: Deal[]) => {
      releaseConfirmedPaymentLocks(cloudDeals);
      releaseConfirmedPitchLocks(cloudDeals);
      return mergeCloudDealsWithLocal(localDeals, cloudDeals, {
        paymentLocks: paymentLocksRef.current,
        pitchLocks: pitchLocksRef.current,
        withdrawnLocks: withdrawnLocksRef.current,
        releaseStalePitchLock,
      });
    },
    [releaseConfirmedPaymentLocks, releaseConfirmedPitchLocks, releaseStalePitchLock],
  );

  const persistDeal = useCallback(async (deal: Deal) => {
    const resolved = resolveDealDeveloperId(deal, campaignsRef.current);
    await upsertDeal(resolved);
  }, []);

  const influencerDeals = useMemo(
    () => getInfluencerDeals(visibleDeals, influencerId),
    [influencerId, visibleDeals],
  );

  const mergeCloudSnapshot = useCallback(
    (accountId: string, cloudDeals: Deal[], campaignIds: string[]) => {
      const normalized = normalizeStoredDeals(
        resolveDealsDeveloperIds(cloudDeals, campaignsRef.current),
      );

      setDeals((prev) => {
        const base = prev.length > 0 ? prev : localSnapshotRef.current;
        const cloudMerged = mergeDeals(base, normalized);
        const cloudById = new Map(normalized.map((deal) => [deal.id, deal]));
        let merged = mergeDeals(prev, cloudMerged);

        // Never let local counter cache hide a cloud accept — raw deals stay lock-free.
        merged = merged.map((deal) => {
          const cloud = cloudById.get(deal.id);
          if (
            cloud &&
            (isDealReadyForDeveloperPayment(cloud) || cloud.deliveryStatus === 'pending_review')
          ) {
            releaseStalePitchLock(deal.id);
            return pickPreferredDeal(deal, cloud);
          }
          return deal;
        });

        const next = merged;
        dealsRef.current = applyPitchLocksToDeals(next);

        void (async () => {
          const enriched = await enrichDealsWithMetrics(next);

          const metricsById = new Map(enriched.map((deal) => [deal.id, deal]));
          setDeals((current) => {
            const withMetrics = current.map((deal) => {
              const metrics = metricsById.get(deal.id);
              if (!metrics) return deal;

              return {
                ...deal,
                audienceFollowers: metrics.audienceFollowers,
                engagementRate: metrics.engagementRate ?? deal.engagementRate,
                estimatedReach: metrics.estimatedReach ?? deal.estimatedReach,
                influencerName: metrics.influencerName ?? deal.influencerName,
                influencerHandle: metrics.influencerHandle ?? deal.influencerHandle,
                influencerAvatarUrl: metrics.influencerAvatarUrl ?? deal.influencerAvatarUrl,
                influencerPlatforms: metrics.influencerPlatforms ?? deal.influencerPlatforms,
              };
            });
            writeLocalDealsSnapshot(localSnapshotRef, withMetrics, accountId, campaignIds);
            return withMetrics;
          });
          setIsHydrated(true);
        })();

        writeLocalDealsSnapshot(localSnapshotRef, next, accountId, campaignIds);
        setIsHydrated(true);
        return next;
      });
    },
    [applyPitchLocksToDeals, mergeDeals, releaseStalePitchLock],
  );

  useEffect(() => {
    let cancelled = false;
    const accountId = user?.uid ?? null;
    const campaignIds = ownedCampaignIds;
    const userChanged = lastHydratedUserRef.current !== accountId;

    async function hydrateFromLocal(targetAccountId: string) {
      const stored = await loadStoredPitches(targetAccountId, campaignIds);
      if (cancelled) return;

      const cleaned = normalizeStoredDeals(stored);
      const refreshed = await enrichDealsWithMetrics(cleaned);
      if (cancelled) return;

      localSnapshotRef.current = refreshed;
      setDeals(refreshed);
      persistDeals(refreshed);
      setIsHydrated(true);
    }

    function attachCloudSubscription(targetAccountId: string) {
      dealsUnsubscribeRef.current?.();

      if (!getDb()) {
        void hydrateFromLocal(targetAccountId);
        return;
      }

      const unsubscribe = subscribeUserDeals(
        targetAccountId,
        campaignIds,
        (cloudDeals) => {
          if (cancelled) return;
          mergeCloudSnapshot(targetAccountId, cloudDeals, campaignIds);
        },
        () => {
          if (!cancelled) void hydrateFromLocal(targetAccountId);
        },
      );

      dealsUnsubscribeRef.current = unsubscribe;

      if (!unsubscribe) {
        void hydrateFromLocal(targetAccountId);
      }
    }

    if (!accountId) {
      lastHydratedUserRef.current = null;
      dealsUnsubscribeRef.current?.();
      dealsUnsubscribeRef.current = null;
      setDeals([]);
      setIsHydrated(true);
      return () => {
        cancelled = true;
      };
    }

    if (userChanged) {
      migratedRef.current = false;
      paymentLocksRef.current.clear();
      pitchLocksRef.current.clear();
      withdrawnLocksRef.current.clear();
      localSnapshotRef.current = [];
      setDeals([]);
      setNegotiationRevision(0);
      setIsHydrated(false);
      lastHydratedUserRef.current = accountId;

      void (async () => {
        const stored = await loadStoredPitches(accountId, campaignIds);
        if (cancelled) return;

        const cleaned = normalizeStoredDeals(stored);
        const savedLocks = await loadNegotiationLocks(accountId);
        if (cancelled) return;

        for (const deal of cleaned) {
          const lock = savedLocks.get(deal.id);
          if (!lock) continue;
          // Local JSON can lag Firestore — drop saved locks the cache has already surpassed.
          if (
            isDealReadyForDeveloperPayment(deal) ||
            deal.deliveryStatus === 'pending_review' ||
            deal.deliveryStatus === 'approved' ||
            dealNegotiationTimestamp(deal) >= dealNegotiationTimestamp(lock)
          ) {
            savedLocks.delete(deal.id);
          }
        }

        pitchLocksRef.current = savedLocks;
        void saveNegotiationLocks(accountId, savedLocks);
        setNegotiationRevision((revision) => revision + 1);

        if (!getDb()) {
          const hydrated = cleaned.map((deal) => {
            const lock = pitchLocksRef.current.get(deal.id);
            if (!lock || !shouldApplyPitchLock(deal, lock)) return deal;
            return pickPreferredDeal(deal, lock);
          });
          localSnapshotRef.current = hydrated;
          setDeals(hydrated);
          persistDeals(hydrated);
          setIsHydrated(true);
          return;
        }

        localSnapshotRef.current = cleaned;
        setDeals(cleaned);

        const resolved = resolveDealsDeveloperIds(cleaned, campaignsRef.current);
        if (!migratedRef.current && resolved.length > 0) {
          await migrateLocalDealsToFirestore(resolved, accountId);
          migratedRef.current = true;
        }

        if (cancelled) return;
        attachCloudSubscription(accountId);
      })();
    } else {
      attachCloudSubscription(accountId);
    }

    return () => {
      cancelled = true;
      dealsUnsubscribeRef.current?.();
      dealsUnsubscribeRef.current = null;
    };
  }, [user?.uid, ownedCampaignIds.join('|'), mergeCloudSnapshot, persistDeals]);

  useEffect(() => {
    if (!isHydrated || campaigns.length === 0) return;

    setDeals((prev) => {
      let changed = false;
      const next = prev.map((deal) => {
        if (deal.developerId) return deal;
        const { developerId } = getDealCampaignContext(deal, campaigns);
        if (!developerId) return deal;
        changed = true;
        const updated = resolveDealDeveloperId({ ...deal, developerId }, campaigns);
        void persistDeal(updated);
        return updated;
      });
      return changed ? next : prev;
    });
  }, [campaigns, isHydrated, persistDeal]);

  const pitchedClipIds = useMemo(
    () => new Set(influencerDeals.map((deal) => getCampaignIdFromDeal(deal))),
    [influencerDeals],
  );

  const submitPitch = useCallback(
    (clip: AppClip, rate: number, influencer: InfluencerProfile) => {
      if (!influencerId) {
        Alert.alert('Sign in required', 'Sign in before pitching campaigns.');
        return;
      }

      if (!getDb()) {
        Alert.alert('Firebase not configured', 'Pitches cannot sync until Firebase is set up.');
        return;
      }

      if (getExistingDealForCampaign(deals, clip.id)) {
        alertAlreadyPitchedCampaign(clip.appName);
        return;
      }

      const pitchId = buildPitchDealId(clip.id, influencerId);
      let savedDeal: Deal | undefined;

      setDeals((prev) => {
        if (getExistingDealForCampaign(prev, clip.id)) {
          return prev;
        }

        const nextDeal = resolveDealDeveloperId(
          clipToPendingDeal(clip, rate, influencer, influencerId),
          campaignsRef.current,
        );

        savedDeal = nextDeal;
        const next = [nextDeal, ...prev];
        persistDeals(next);
        return next;
      });

      if (!savedDeal) {
        alertAlreadyPitchedCampaign(clip.appName);
        return;
      }

      if (!savedDeal) return;

      setPitchLock(pitchId, savedDeal);

      void (async () => {
        let persisted = false;
        for (let attempt = 0; attempt < 3 && !persisted; attempt += 1) {
          try {
            await persistDeal(savedDeal!);
            persisted = true;
          } catch (error) {
            console.warn(
              `[PitchesContext] submitPitch persist attempt ${attempt + 1} failed:`,
              pitchId,
              error,
            );
            if (attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
            }
          }
        }

        if (!persisted) {
          Alert.alert(
            'Pitch not saved',
            'Your pitch is on this device but failed to sync. Check your connection and try again.',
          );
          return;
        }

        Alert.alert(
          'Pitch sent',
          `Your ${formatCurrency(rate)} pitch for ${clip.appName} is waiting for the developer.`,
        );

        void notifyDealEvent(
          clip.developerId,
          'new_pitch',
          savedDeal!,
          'New pitch',
          `${influencer.name} pitched ${formatCurrency(rate)} for ${clip.appName}.`,
        );

        void ensureThreadForDeal(savedDeal!);
        void appendChatMessage({
          dealId: savedDeal!.id,
          senderId: influencerId,
          type: 'system',
          text: `${influencer.name} pitched ${formatCurrency(rate)} for ${clip.appName}.`,
          developerId: savedDeal!.developerId!,
          influencerId,
        });
      })();
    },
    [influencerId, persistDeal, persistDeals, setPitchLock],
  );

  const submitBookingRequest = useCallback(
    (creator: CreatorBrowseProfile, campaign: Campaign, developerId: string): boolean => {
      if (!developerId) return false;

      let savedDeal: Deal | undefined;
      let success = false;

      setDeals((prev) => {
        const bookingId = buildPitchDealId(campaign.id, creator.id);
        const existing = prev.find((deal) => deal.id === bookingId);
        if (existing && isDealInProgress(existing)) return prev;

        const nextDeal = creatorBookingToPendingDeal(creator, campaign, developerId);
        const next = existing
          ? prev.map((deal) => (deal.id === bookingId ? { ...nextDeal, id: bookingId } : deal))
          : [nextDeal, ...prev];

        savedDeal = existing ? { ...nextDeal, id: bookingId } : nextDeal;
        success = true;
        persistDeals(next);
        return next;
      });

      if (savedDeal) {
        void persistDeal(savedDeal);
      }

      return success;
    },
    [persistDeal, persistDeals],
  );

  const markDealCompleted = useCallback(
    async (dealId: string): Promise<boolean> => {
      const existing = dealsRef.current.find((deal) => deal.id === dealId);
      if (!existing || !isDealPaymentSecured(existing)) {
        return false;
      }

      const dealForRelease = resolveDealDeveloperId(existing, campaignsRef.current);

      try {
        await persistDeal(dealForRelease);
      } catch (error) {
        console.warn('[PitchesContext] markDealCompleted persist failed:', dealId, error);
        Alert.alert(
          'Could not confirm post',
          'Deal could not be saved. Check your connection and try again.',
        );
        return false;
      }

      let transferId: string | null | undefined;
      if (existing.paymentStatus !== 'released' && existing.paymentStatus !== 'withdrawn') {
        try {
          const result = await releaseDealPayout(dealId);
          transferId = result.transferId;
        } catch (error) {
          const status = error instanceof ApiError ? error.status : 0;
          const message =
            status === 404
              ? 'Payout release endpoint is missing on the server. Restart or redeploy fase-backend with the latest code.'
              : error instanceof Error
                ? error.message
                : 'Could not release payout.';
          Alert.alert('Could not confirm post', message);
          return false;
        }
      }

      setDeals((prev) => {
        const next = prev.map((deal) => {
          if (deal.id !== dealId) return deal;
          let updated = applyDealCompletedState(deal);
          if (updated.paymentStatus === 'held') {
            updated = applyDealPayoutReleasedState({
              ...updated,
              stripeTransferId: transferId ?? updated.stripeTransferId,
              payoutReleasedAt: new Date().toISOString(),
            });
          }
          void persistDeal(updated);
          return updated;
        });
        persistDeals(next);
        return next;
      });

      void notifyDealEvent(
        existing.influencerId,
        'post_confirmed',
        existing,
        'Post confirmed',
        `${existing.appName} confirmed your post is live. Your payout is ready to cash out.`,
      );

      return true;
    },
    [persistDeal, persistDeals],
  );

  const processAutoPostReleases = useCallback(async () => {
    if (!influencerId || !isApiConfigured()) return;

    const eligible = dealsRef.current.filter(
      (deal) =>
        deal.influencerId === influencerId &&
        isDealEligibleForAutoPostRelease(deal) &&
        !autoReleaseInFlightRef.current.has(deal.id),
    );

    for (const existing of eligible) {
      autoReleaseInFlightRef.current.add(existing.id);

      try {
        const result = await autoReleaseDealPayout(existing.id);

        setDeals((prev) => {
          const next = prev.map((deal) => {
            if (deal.id !== existing.id) return deal;

            let updated = applyDealCompletedState({
              ...deal,
              postAutoReleased: true,
            });

            if (updated.paymentStatus === 'held') {
              updated = applyDealPayoutReleasedState({
                ...updated,
                stripeTransferId: result.transferId ?? updated.stripeTransferId,
                payoutReleasedAt: new Date().toISOString(),
              });
            }

            void persistDeal(updated);
            return updated;
          });
          persistDeals(next);
          return next;
        });

        void notifyDealEvent(
          existing.influencerId,
          'post_confirmed',
          existing,
          'Payout released',
          `${existing.appName} — your payout auto-released after ${POST_CONFIRMATION_AUTO_RELEASE_DAYS} days. Cash out from Earnings.`,
        );
      } catch (error) {
        if (__DEV__) {
          console.warn('[PitchesContext] auto-release failed:', existing.id, error);
        }
      } finally {
        autoReleaseInFlightRef.current.delete(existing.id);
      }
    }
  }, [influencerId, persistDeal, persistDeals]);

  useEffect(() => {
    if (!isHydrated || !influencerId) return;
    void processAutoPostReleases();
  }, [deals, influencerId, isHydrated, processAutoPostReleases]);

  const submitCounterOffer = useCallback(
    (dealId: string, amount: number): boolean => {
      const existing = dealsRef.current.find((deal) => deal.id === dealId);
      if (!existing || existing.developerHasCountered || existing.counterOfferAmount != null) {
        return false;
      }

      const pitchedRate = existing.pitchedRate ?? existing.amount;
      const updated: Deal = {
        ...existing,
        developerHasCountered: true,
        developerReviewStatus: 'negotiating',
        counterOfferAmount: amount,
        status: 'Counter Offer',
        statusLabel: `Counter offer · ${formatCurrency(amount)}`,
        detailsDescription: `${existing.appName} sent you a counter offer of ${formatCurrency(amount)}. Your original pitch was ${formatCurrency(pitchedRate)}. Accept to move forward or keep your original rate.`,
        negotiationUpdatedAt: new Date().toISOString(),
      };

      setPitchLock(dealId, updated);
      setDeals((prev) => {
        const next = prev.map((deal) => (deal.id === dealId ? updated : deal));
        persistDeals(next);
        return next;
      });
      requestDeveloperPitchesTab('negotiating');

      void persistDeal(updated);
      void notifyDealEvent(
        existing.influencerId,
        'counter_offer',
        updated,
        'Counter offer',
        `${existing.appName} sent a counter offer of ${formatCurrency(amount)}.`,
      );

      return true;
    },
    [persistDeal, persistDeals, requestDeveloperPitchesTab, setPitchLock],
  );

  const acceptPitchOffer = useCallback(
    (dealId: string): boolean => {
      const existing = dealsRef.current.find((deal) => deal.id === dealId);
      if (!existing) return false;
      if (isDealPaidByDeveloper(existing)) return false;
      if (isDealRateAgreed(existing)) return true;
      if (existing.developerHasCountered || existing.counterOfferAmount != null) return false;
      if (existing.developerReviewStatus !== 'new') return false;

      const pitchedRate = existing.pitchedRate ?? existing.amount;
      const shippingStatus = shippingStatusAfterRateAgreed(Boolean(existing.requiresShipping));
      const updated: Deal = {
        ...existing,
        developerReviewStatus: 'negotiating',
        type: 'pending',
        status: 'Awaiting Payment',
        statusLabel: `Pitch accepted · ${formatCurrency(pitchedRate)}`,
        detailsDescription: shippingStatus
          ? `${existing.appName} accepted your ${formatCurrency(pitchedRate)} pitch. Share your shipping address in chat so they can send the product.`
          : `${existing.appName} accepted your ${formatCurrency(pitchedRate)} pitch. Send your draft video in chat for them to review.`,
        negotiationUpdatedAt: new Date().toISOString(),
        deliveryStatus: 'awaiting_submission',
        shippingStatus,
      };

      setPitchLock(dealId, updated);
      setDeals((prev) => {
        const next = prev.map((deal) => (deal.id === dealId ? updated : deal));
        persistDeals(next);
        return next;
      });
      requestDeveloperPitchesTab('negotiating');

      void (async () => {
        try {
          await persistDeal(updated);
        } catch (error) {
          console.warn('[PitchesContext] acceptPitchOffer persist failed:', dealId, error);
        }
      })();

      void notifyDealEvent(
        existing.influencerId,
        'pitch_accepted',
        updated,
        'Pitch accepted',
        `${existing.appName} accepted your ${formatCurrency(pitchedRate)} pitch.${
          shippingStatus ? ' Share your shipping address in chat.' : ' Send your draft video in chat.'
        }`,
      );

      void appendChatMessage({
        dealId,
        senderId: existing.developerId ?? 'developer',
        type: 'system',
        text: shippingStatus
          ? `${existing.appName} accepted the ${formatCurrency(pitchedRate)} pitch. Share your shipping address in chat.`
          : `${existing.appName} accepted the ${formatCurrency(pitchedRate)} pitch. Waiting for a draft video.`,
        developerId: existing.developerId!,
        influencerId: existing.influencerId!,
      });

      return true;
    },
    [persistDeal, persistDeals, requestDeveloperPitchesTab, setPitchLock],
  );

  const acceptCounterOffer = useCallback(
    (dealId: string): boolean => {
      const locked = pitchLocksRef.current.get(dealId);
      const existing =
        dealsRef.current.find((deal) => deal.id === dealId) ?? locked;

      if (!existing) return false;

      if (isDealReadyForDeveloperPayment(existing)) {
        return true;
      }

      const counterAmount =
        existing.counterOfferAmount ??
        locked?.counterOfferAmount ??
        pitchLocksRef.current.get(dealId)?.counterOfferAmount;

      if (counterAmount == null) return false;

      const originalPitchRate = existing.pitchedRate ?? existing.amount;
      const baseDeal =
        existing.counterOfferAmount != null
          ? existing
          : { ...existing, counterOfferAmount: counterAmount };
      const { counterOfferAmount: _removed, ...dealWithoutCounter } = baseDeal;
      const shippingStatus = shippingStatusAfterRateAgreed(Boolean(existing.requiresShipping));
      const updated: Deal = {
        ...dealWithoutCounter,
        amount: counterAmount,
        pitchedRate: originalPitchRate,
        developerHasCountered: true,
        developerReviewStatus: 'negotiating',
        type: 'pending',
        status: 'Awaiting Payment',
        statusLabel: `Counter accepted · ${formatCurrency(counterAmount)}`,
        detailsDescription: shippingStatus
          ? `You accepted the ${formatCurrency(counterAmount)} counter offer. Share your shipping address in chat so ${existing.appName} can send the product.`
          : `You accepted the ${formatCurrency(counterAmount)} counter offer. Send your draft video in chat for ${existing.appName} to review.`,
        negotiationUpdatedAt: new Date().toISOString(),
        deliveryStatus: 'awaiting_submission',
        shippingStatus,
      };

      setPitchLock(dealId, updated);
      setDeals((prev) => {
        const next = prev.map((deal) => (deal.id === dealId ? updated : deal));
        persistDeals(next);
        return next;
      });
      requestDeveloperPitchesTab('negotiating');

      void (async () => {
        try {
          await persistDeal(updated);
        } catch (error) {
          console.warn('[PitchesContext] acceptCounterOffer persist failed:', dealId, error);
        }
      })();

      const developerId = resolveDealDeveloperId(updated, campaignsRef.current).developerId;
      if (developerId) {
        void notifyDealEvent(
          developerId,
          'counter_offer',
          updated,
          'Counter accepted',
          `${updated.influencerName ?? 'Creator'} accepted your ${formatCurrency(counterAmount)} counter. Review their draft video in chat.`,
        );

        void appendChatMessage({
          dealId,
          senderId: updated.influencerId!,
          type: 'system',
          text: shippingStatus
            ? `Counter accepted at ${formatCurrency(counterAmount)}. Share your shipping address in chat.`
            : `Counter accepted at ${formatCurrency(counterAmount)}. Send your draft video when ready.`,
          developerId: developerId,
          influencerId: updated.influencerId!,
        });
      }

      return true;
    },
    [persistDeal, persistDeals, requestDeveloperPitchesTab, setPitchLock],
  );

  const rejectCounterOffer = useCallback(
    (dealId: string) => {
      const existing = dealsRef.current.find((deal) => deal.id === dealId);
      if (!existing) return;

      const pitchedRate = existing.pitchedRate ?? existing.amount;
      const { counterOfferAmount: _removed, ...dealWithoutCounter } = existing;
      const updated: Deal = {
        ...dealWithoutCounter,
        developerReviewStatus: 'new',
        status: 'Pending Review',
        statusLabel: 'Pending Review',
        detailsDescription: `You pitched ${formatCurrency(pitchedRate)} for ${existing.appName}. Waiting for the team to respond.`,
        negotiationUpdatedAt: new Date().toISOString(),
      };

      clearPitchLock(dealId);
      setDeals((prev) => {
        const next = prev.map((deal) => (deal.id === dealId ? updated : deal));
        persistDeals(next);
        return next;
      });
      requestDeveloperPitchesTab('new');
      void persistDeal(updated);
    },
    [clearPitchLock, persistDeal, persistDeals, requestDeveloperPitchesTab],
  );

  const updatePitchStatus = useCallback(
    async (dealId: string, status: PitchStatus, paymentIntentId?: string) => {
      const existing = dealsRef.current.find((deal) => deal.id === dealId);
      if (!existing) {
        return { persisted: false };
      }

      if (isDealCashedOut(existing)) {
        return { deal: existing, persisted: true };
      }

      let updatedDeal: Deal = { ...existing, developerReviewStatus: status };

      if (paymentIntentId) {
        updatedDeal.paymentIntentId = paymentIntentId;
      }

      if (status === 'accepted') {
        const finalAmount =
          existing.counterOfferAmount ?? existing.pitchedRate ?? existing.amount;
        const { counterOfferAmount: _removed, ...withoutCounter } = updatedDeal;

        updatedDeal = {
          ...withoutCounter,
          amount: finalAmount,
          pitchedRate: finalAmount,
        };

        if (paymentIntentId) {
          updatedDeal = applyPaymentSecuredState({
            ...updatedDeal,
            paymentIntentId,
            amount: finalAmount,
          });
        } else {
          updatedDeal = {
            ...updatedDeal,
            type: 'active',
            status: 'Awaiting Confirmation',
            statusLabel: 'Awaiting Confirmation',
            detailsDescription: `Deal confirmed at ${formatCurrency(finalAmount)} for ${existing.appName}. Waiting for payment from the developer.`,
          };
        }
      }

      if (status === 'negotiating') {
        updatedDeal = {
          ...updatedDeal,
          type: 'pending',
          status: 'Counter Offer',
        };
      }

      if (status === 'accepted' && paymentIntentId) {
        clearPitchLock(dealId);
        paymentLocksRef.current.set(dealId, updatedDeal);
        requestDeveloperPitchesTab('accepted');
      }

      const nextDeals = dealsRef.current.map((deal) =>
        deal.id === dealId ? updatedDeal : deal,
      );
      dealsRef.current = nextDeals;
      setDeals(nextDeals);
      persistDeals(nextDeals);

      let persisted = false;
      for (let attempt = 0; attempt < 3 && !persisted; attempt += 1) {
        try {
          await persistDeal(updatedDeal);
          persisted = true;
        } catch (error) {
          console.warn(
            `[PitchesContext] persist attempt ${attempt + 1} failed for ${dealId}`,
            error,
          );
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
          }
        }
      }

      if (!persisted) {
        console.warn('[PitchesContext] keeping local paid state after Firestore persist failed', dealId);
      }

      if (status === 'accepted' && paymentIntentId) {
        const campaignId = getCampaignIdFromDeal(updatedDeal);
        if (campaignId) {
          await deductCampaignBudget(campaignId, updatedDeal.amount);
        }

        await notifyDealEvent(
          updatedDeal.influencerId,
          'payment_received',
          updatedDeal,
          'You got paid',
          `${updatedDeal.appName} paid ${formatCurrency(updatedDeal.amount)}. Cash out from Earnings.`,
        );
      }

      return { deal: updatedDeal, persisted };
    },
    [clearPitchLock, deductCampaignBudget, persistDeal, persistDeals, requestDeveloperPitchesTab],
  );

  const markDealDeclined = useCallback(
    async (dealId: string, declinedBy: DealDeclinedBy): Promise<boolean> => {
      const existing = dealsRef.current.find((deal) => deal.id === dealId);
      if (!existing) return false;

      if (existing.paymentIntentId) {
        try {
          await cancelDealPayment(existing.paymentIntentId);
        } catch (error) {
          console.warn('[PitchesContext] payment cancel failed before decline', dealId, error);
        }
      }

      const declined = applyDealDeclinedState(existing, declinedBy);
      clearPitchLock(dealId);
      paymentLocksRef.current.delete(dealId);
      withdrawnLocksRef.current.delete(dealId);
      pitchLocksRef.current.delete(dealId);

      const next = filterActiveDeals(dealsRef.current.map((deal) => (deal.id === dealId ? declined : deal)));
      dealsRef.current = next;
      setDeals(next);
      persistDeals(next);

      if (!getDb()) {
        return true;
      }

      try {
        await persistDeal(declined);
        return true;
      } catch (error) {
        console.warn('[PitchesContext] decline deal failed', dealId, error);
        return false;
      }
    },
    [clearPitchLock, persistDeal, persistDeals],
  );

  const deleteDealPermanently = useCallback(
    async (dealId: string): Promise<boolean> => {
      const existing = dealsRef.current.find((deal) => deal.id === dealId);
      if (!existing) return false;

      if (existing.paymentIntentId) {
        try {
          await cancelDealPayment(existing.paymentIntentId);
        } catch (error) {
          console.warn('[PitchesContext] payment cancel failed before delete', dealId, error);
        }
      }

      const next = dealsRef.current.filter((deal) => deal.id !== dealId);
      dealsRef.current = next;
      clearPitchLock(dealId);
      paymentLocksRef.current.delete(dealId);
      withdrawnLocksRef.current.delete(dealId);
      setDeals(next);
      persistDeals(next);

      if (!getDb()) {
        return true;
      }

      try {
        await deleteDeal(dealId);
        return true;
      } catch (error) {
        console.warn('[PitchesContext] delete deal failed', dealId, error);
        return false;
      }
    },
    [clearPitchLock, persistDeals],
  );

  const declinePitch = useCallback(
    (dealId: string) => markDealDeclined(dealId, 'developer'),
    [markDealDeclined],
  );

  const declineDeal = useCallback(
    (dealId: string) => markDealDeclined(dealId, 'influencer'),
    [markDealDeclined],
  );

  const removeDeal = useCallback(
    (dealId: string) => deleteDealPermanently(dealId),
    [deleteDealPermanently],
  );

  const markDealsCashedOut = useCallback(
    (dealIds: string[]) => {
      const idSet = new Set(dealIds);
      for (const id of dealIds) {
        paymentLocksRef.current.delete(id);
        clearPitchLock(id);
      }

      const nextDeals = dealsRef.current.map((deal) => {
        if (!idSet.has(deal.id)) return deal;
        const cashedOut = applyDealCashedOutState(deal);
        withdrawnLocksRef.current.set(deal.id, cashedOut);
        return cashedOut;
      });

      dealsRef.current = nextDeals;
      setDeals(nextDeals);
      persistDeals(nextDeals);

      const cashedOut = nextDeals.filter((deal) => idSet.has(deal.id));
      void (async () => {
        for (const deal of cashedOut) {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await persistDeal(deal);
              break;
            } catch {
              if (attempt === 2) break;
              await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
            }
          }
        }
      })();
    },
    [clearPitchLock, persistDeal, persistDeals],
  );

  const syncInfluencerAudienceMetrics = useCallback(
    (uid: string, profile: InfluencerProfile) => {
      setDeals((prev) => {
        let changed = false;
        const next = prev.map((deal) => {
          if (deal.influencerId !== uid) return deal;
          changed = true;
          const updated = applyProfileMetricsToDeal(deal, profile);
          void persistDeal(updated);
          return updated;
        });
        if (changed) persistDeals(next);
        return changed ? next : prev;
      });
    },
    [persistDeal, persistDeals],
  );

  const getDealById = useCallback(
    (id: string) => visibleDeals.find((deal) => deal.id === id),
    [visibleDeals],
  );

  const submitDeliveryVideo = useCallback(
    async (dealId: string, localUri: string): Promise<boolean> => {
      const existing = dealsRef.current.find((deal) => deal.id === dealId);
      if (!existing?.influencerId || !existing.developerId) return false;
      if (isDealPaidByDeveloper(existing)) return false;
      if (!isShippingComplete(existing)) return false;

      try {
        const upload = await runDeliveryVideoUpload(localUri, () => {});
        const now = new Date().toISOString();
        const updated: Deal = {
          ...existing,
          deliveryUrl: upload.videoUrl,
          deliverySubmittedAt: now,
          deliveryStatus: 'pending_review',
          negotiationUpdatedAt: now,
        };

        setDeals((prev) => {
          const next = prev.map((deal) => (deal.id === dealId ? updated : deal));
          persistDeals(next);
          return next;
        });

        await persistDeal(updated);
        await ensureThreadForDeal(updated);

        await appendChatMessage({
          dealId,
          senderId: existing.influencerId,
          type: 'video',
          videoUrl: upload.videoUrl,
          thumbnailUrl: upload.thumbnailUrl,
          developerId: existing.developerId,
          influencerId: existing.influencerId!,
          senderDisplayName: existing.influencerName ?? 'Creator',
          skipPush: true,
        });

        await notifyDealEvent(
          existing.developerId,
          'delivery_submitted',
          updated,
          'Draft video submitted',
          `${existing.influencerName ?? 'Creator'} sent a draft video for ${existing.appName}.`,
        );

        return true;
      } catch (error) {
        console.warn('[PitchesContext] submitDeliveryVideo failed:', dealId, error);
        return false;
      }
    },
    [persistDeal, persistDeals],
  );

  const syncDeliveryPendingReview = useCallback(
    async (
      dealId: string,
      input?: { videoUrl?: string; thumbnailUrl?: string },
    ): Promise<boolean> => {
      const existing = dealsRef.current.find((deal) => deal.id === dealId);
      if (!existing) return false;
      if (isDealPaidByDeveloper(existing)) return false;
      if (existing.deliveryStatus === 'pending_review' || existing.deliveryStatus === 'approved') {
        return true;
      }

      const videoUrl = input?.videoUrl ?? existing.deliveryUrl;
      if (!videoUrl) return false;

      const now = new Date().toISOString();
      const updated: Deal = {
        ...existing,
        deliveryUrl: videoUrl,
        deliverySubmittedAt: existing.deliverySubmittedAt ?? now,
        deliveryStatus: 'pending_review',
        negotiationUpdatedAt: now,
      };

      releaseStalePitchLock(dealId);
      setDeals((prev) => {
        const next = prev.map((deal) => (deal.id === dealId ? updated : deal));
        persistDeals(next);
        return next;
      });

      try {
        await persistDeal(updated);
        return true;
      } catch (error) {
        console.warn('[PitchesContext] syncDeliveryPendingReview failed:', dealId, error);
        return false;
      }
    },
    [persistDeal, persistDeals, releaseStalePitchLock],
  );

  const approveDelivery = useCallback(
    async (dealId: string): Promise<boolean> => {
      let existing = dealsRef.current.find((deal) => deal.id === dealId);
      if (!existing?.developerId || !existing.influencerId) return false;
      if (existing.deliveryStatus !== 'pending_review') {
        const synced = await syncDeliveryPendingReview(dealId);
        if (!synced) return false;
        existing = dealsRef.current.find((deal) => deal.id === dealId);
        if (!existing || existing.deliveryStatus !== 'pending_review') return false;
      }
      if (isDealPaidByDeveloper(existing)) return false;

      const payableRate =
        existing.counterOfferAmount ??
        (isDealRateAgreed(existing) ? existing.amount : undefined) ??
        existing.pitchedRate ??
        existing.amount;

      const updated: Deal = {
        ...existing,
        deliveryStatus: 'approved',
        amount: payableRate,
        status: 'Awaiting Payment',
        statusLabel: `Video approved · ${formatCurrency(payableRate)}`,
        detailsDescription: `Draft video approved at ${formatCurrency(payableRate)}. Waiting for ${existing.appName} to pay.`,
      };

      setDeals((prev) => {
        const next = prev.map((deal) => (deal.id === dealId ? updated : deal));
        persistDeals(next);
        return next;
      });

      await persistDeal(updated);

      await appendChatMessage({
        dealId,
        senderId: existing.developerId,
        type: 'system',
        text: `Video approved at ${formatCurrency(payableRate)}. Ready for payment.`,
        developerId: existing.developerId,
        influencerId: existing.influencerId!,
      });

      await notifyDealEvent(
        existing.influencerId,
        'deal_approved',
        updated,
        'Video approved',
        `${existing.appName} approved your draft. Waiting for payment.`,
      );

      requestDeveloperPitchesTab('negotiating');
      return true;
    },
    [persistDeal, persistDeals, requestDeveloperPitchesTab, syncDeliveryPendingReview],
  );

  const requestDeliveryChanges = useCallback(
    async (dealId: string, note?: string): Promise<boolean> => {
      let existing = dealsRef.current.find((deal) => deal.id === dealId);
      if (!existing?.developerId || !existing.influencerId) return false;
      if (existing.deliveryStatus !== 'pending_review') {
        const synced = await syncDeliveryPendingReview(dealId);
        if (!synced) return false;
        existing = dealsRef.current.find((deal) => deal.id === dealId);
        if (!existing || existing.deliveryStatus !== 'pending_review') return false;
      }

      const updated: Deal = {
        ...existing,
        deliveryStatus: 'awaiting_submission',
        statusLabel: existing.statusLabel.includes('Counter accepted')
          ? existing.statusLabel
          : 'Revisions requested',
      };

      setDeals((prev) => {
        const next = prev.map((deal) => (deal.id === dealId ? updated : deal));
        persistDeals(next);
        return next;
      });

      await persistDeal(updated);

      const messageText = note?.trim()
        ? `Revision requested: ${note.trim()}`
        : 'Revision requested — please send an updated draft video.';

      await appendChatMessage({
        dealId,
        senderId: existing.developerId,
        type: 'system',
        text: messageText,
        developerId: existing.developerId,
        influencerId: existing.influencerId!,
      });

      await notifyDealEvent(
        existing.influencerId,
        'delivery_submitted',
        updated,
        'Revisions requested',
        `${existing.appName} requested changes to your draft video.`,
      );

      return true;
    },
    [persistDeal, persistDeals, syncDeliveryPendingReview],
  );

  const submitShippingAddress = useCallback(
    (dealId: string, address: ShippingAddress): boolean => {
      const existing = dealsRef.current.find((deal) => deal.id === dealId);
      if (!existing?.influencerId || !existing.developerId) return false;
      if (!existing.requiresShipping || existing.shippingStatus !== 'awaiting_address') {
        return false;
      }

      const now = new Date().toISOString();
      const updated: Deal = {
        ...existing,
        shippingAddress: address,
        shippingStatus: 'address_provided',
        shippingAddressAt: now,
        negotiationUpdatedAt: now,
      };

      setDeals((prev) => {
        const next = prev.map((deal) => (deal.id === dealId ? updated : deal));
        persistDeals(next);
        return next;
      });

      void persistDeal(updated);

      void notifyDealEvent(
        existing.developerId,
        'pitch_accepted',
        updated,
        'Shipping address shared',
        `${existing.influencerName ?? 'Creator'} shared a shipping address for ${existing.appName}.`,
      );

      void appendChatMessage({
        dealId,
        senderId: existing.influencerId,
        type: 'system',
        text: `Shipping address shared:\n${formatShippingAddress(address)}`,
        developerId: existing.developerId,
        influencerId: existing.influencerId!,
      });

      return true;
    },
    [persistDeal, persistDeals],
  );

  const markProductShipped = useCallback(
    (
      dealId: string,
      input?: { trackingNumber?: string; shippingCarrier?: string },
    ): boolean => {
      const existing = dealsRef.current.find((deal) => deal.id === dealId);
      if (!existing?.influencerId || !existing.developerId) return false;
      if (!existing.requiresShipping || existing.shippingStatus !== 'address_provided') {
        return false;
      }

      const now = new Date().toISOString();
      const trackingNumber = input?.trackingNumber?.trim() || undefined;
      const shippingCarrier = input?.shippingCarrier?.trim() || undefined;
      const updated: Deal = {
        ...existing,
        shippingStatus: 'shipped',
        shippedAt: now,
        trackingNumber,
        shippingCarrier,
        negotiationUpdatedAt: now,
      };

      setDeals((prev) => {
        const next = prev.map((deal) => (deal.id === dealId ? updated : deal));
        persistDeals(next);
        return next;
      });

      void persistDeal(updated);

      const trackingNote = trackingNumber
        ? ` Tracking: ${trackingNumber}${shippingCarrier ? ` (${shippingCarrier})` : ''}.`
        : '';

      void notifyDealEvent(
        existing.influencerId,
        'pitch_accepted',
        updated,
        'Product shipped',
        `${existing.appName} marked your product as shipped.${trackingNote}`,
      );

      void appendChatMessage({
        dealId,
        senderId: existing.developerId,
        type: 'system',
        text: `${existing.appName} marked the product as shipped.${trackingNote} Confirm when you receive it.`,
        developerId: existing.developerId,
        influencerId: existing.influencerId!,
      });

      return true;
    },
    [persistDeal, persistDeals],
  );

  const markProductReceived = useCallback(
    (dealId: string): boolean => {
      const existing = dealsRef.current.find((deal) => deal.id === dealId);
      if (!existing?.influencerId || !existing.developerId) return false;
      if (!existing.requiresShipping || existing.shippingStatus !== 'shipped') {
        return false;
      }

      const now = new Date().toISOString();
      const updated: Deal = {
        ...existing,
        shippingStatus: 'received',
        receivedAt: now,
        negotiationUpdatedAt: now,
      };

      setDeals((prev) => {
        const next = prev.map((deal) => (deal.id === dealId ? updated : deal));
        persistDeals(next);
        return next;
      });

      void persistDeal(updated);

      void notifyDealEvent(
        existing.developerId,
        'pitch_accepted',
        updated,
        'Product received',
        `${existing.influencerName ?? 'Creator'} confirmed they received the product.`,
      );

      void appendChatMessage({
        dealId,
        senderId: existing.influencerId,
        type: 'system',
        text: `${existing.influencerName ?? 'Creator'} confirmed the product was received. Send your draft video when ready.`,
        developerId: existing.developerId,
        influencerId: existing.influencerId!,
      });

      return true;
    },
    [persistDeal, persistDeals],
  );

  const isPitched = useCallback(
    (clipId: string) => pitchedClipIds.has(clipId),
    [pitchedClipIds],
  );

  const hasDealInProgressForClip = useCallback(
    (clipId: string) => !!getDealInProgressForCampaign(influencerDeals, clipId),
    [influencerDeals],
  );

  const value = useMemo(
    () => ({
      deals: visibleDeals,
      influencerDeals,
      pitchedClipIds,
      isHydrated,
      submitPitch,
      submitBookingRequest,
      markDealCompleted,
      submitCounterOffer,
      acceptPitchOffer,
      acceptCounterOffer,
      requestDeveloperPitchesTab,
      consumeDeveloperPitchesTabIntent,
      refreshDealsSnapshot,
      rejectCounterOffer,
      updatePitchStatus,
      deleteDealPermanently,
      declinePitch,
      declineDeal,
      removeDeal,
      markDealsCashedOut,
      syncInfluencerAudienceMetrics,
      getDealById,
      isPitched,
      hasDealInProgressForClip,
      submitDeliveryVideo,
      approveDelivery,
      requestDeliveryChanges,
      syncDeliveryPendingReview,
      submitShippingAddress,
      markProductShipped,
      markProductReceived,
    }),
    [
      visibleDeals,
      influencerDeals,
      pitchedClipIds,
      isHydrated,
      submitPitch,
      submitBookingRequest,
      markDealCompleted,
      submitCounterOffer,
      acceptPitchOffer,
      acceptCounterOffer,
      requestDeveloperPitchesTab,
      consumeDeveloperPitchesTabIntent,
      refreshDealsSnapshot,
      rejectCounterOffer,
      updatePitchStatus,
      deleteDealPermanently,
      declinePitch,
      declineDeal,
      removeDeal,
      markDealsCashedOut,
      syncInfluencerAudienceMetrics,
      getDealById,
      isPitched,
      hasDealInProgressForClip,
      submitDeliveryVideo,
      approveDelivery,
      requestDeliveryChanges,
      syncDeliveryPendingReview,
      submitShippingAddress,
      markProductShipped,
      markProductReceived,
    ],
  );

  return <PitchesContext.Provider value={value}>{children}</PitchesContext.Provider>;
}

export function usePitches() {
  const ctx = useContext(PitchesContext);
  if (!ctx) throw new Error('usePitches must be used within PitchesProvider');
  return ctx;
}
