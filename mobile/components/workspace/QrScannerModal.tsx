import React from 'react';
import {
  Modal,
  KeyboardAvoidingView,
  View,
  Text,
  Pressable,
  Platform,
  StyleSheet,
} from 'react-native';
import { CameraView } from 'expo-camera';

interface Props {
  visible: boolean;
  styles: Record<string, any>;
  qrScanEnabled: boolean;
  onBarcodeScanned: ({ data }: { data: string }) => void;
  onRescan: () => void;
  onClose: () => void;
}

export function QrScannerModal({
  visible,
  styles,
  qrScanEnabled,
  onBarcodeScanned,
  onRescan,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.modal, styles.fileBrowserModal]}>
          <Text style={styles.modalTitle}>Scan Bridge QR</Text>
          <Text style={styles.themeHint}>Point camera at the QR code shown in bridge terminal output.</Text>
          <View style={styles.qrScannerWrap}>
            <CameraView
              onBarcodeScanned={qrScanEnabled ? onBarcodeScanned : undefined}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              style={StyleSheet.absoluteFillObject}
            />
          </View>
          <View style={styles.modalActions}>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Close</Text>
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={onRescan}>
              <Text style={styles.cancelText}>Rescan</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
