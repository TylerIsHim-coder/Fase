import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { BrandDashboardScreen } from '@/components/developer/dashboard/BrandDashboardScreen';
import { NewCampaignModal } from '@/components/developer/NewCampaignModal';
import { useNavAction } from '@/context/NavActionContext';

export default function DeveloperDashboardTab() {
  const { registerCenterAction, consumePendingCenterAction } = useNavAction();
  const [modalVisible, setModalVisible] = useState(false);

  const openModal = useCallback(() => {
    setModalVisible(true);
  }, []);

  // Re-register on every focus (a useFocusEffect, unlike campaigns.tsx's mount-only
  // useEffect) so the center `+` keeps working here after visiting Campaigns, whose
  // unmount clears the action via its own cleanup and would otherwise leave the
  // Dashboard's `+` dead until a full remount.
  useFocusEffect(
    useCallback(() => {
      registerCenterAction(openModal);
      consumePendingCenterAction();
      return () => registerCenterAction(null);
    }, [consumePendingCenterAction, openModal, registerCenterAction]),
  );

  return (
    <>
      <BrandDashboardScreen onCreateCampaign={openModal} />
      <NewCampaignModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onPosted={() => setModalVisible(false)}
      />
    </>
  );
}
