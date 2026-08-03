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
