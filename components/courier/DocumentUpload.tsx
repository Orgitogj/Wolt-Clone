import { DOCUMENT_LABELS, REQUIRED_DOCUMENTS, VERIFICATION_LABELS } from '@/constants/deliveryStatus';
import { Colors } from '@/constants/theme';
import { useCourierDocuments, useSubmitCourierDocument } from '@/hooks/useCourier';
import type { CourierDocumentKind, CourierVehicleType } from '@/types/database';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: 'images',
  quality: 0.7,
  allowsEditing: false,
};

export const DocumentUpload = ({ vehicleType }: { vehicleType: CourierVehicleType }) => {
  const { data: documents, isLoading } = useCourierDocuments();
  const submit = useSubmitCourierDocument();
  const [uploading, setUploading] = useState<CourierDocumentKind | null>(null);

  const required = REQUIRED_DOCUMENTS[vehicleType];

  const upload = async (kind: CourierDocumentKind, fromCamera: boolean) => {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        fromCamera
          ? 'Allow camera access to photograph your document.'
          : 'Allow photo access to pick your document.'
      );
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
      : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setUploading(kind);
    try {
      await submit.mutateAsync({ kind, file: { uri: asset.uri, mimeType: asset.mimeType } });
    } catch (error) {
      Alert.alert(
        'Upload failed',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setUploading(null);
    }
  };

  const onPress = (kind: CourierDocumentKind) => {
    Alert.alert(DOCUMENT_LABELS[kind], 'Add a clear photo of the whole document.', [
      { text: 'Take a photo', onPress: () => upload(kind, true) },
      { text: 'Choose from library', onPress: () => upload(kind, false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (isLoading) {
    return <ActivityIndicator color={Colors.secondary} style={styles.loader} />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your documents</Text>
      <Text style={styles.hint}>
        We review these before you can go online. Replace one any time it expires.
      </Text>

      {required.map((kind) => {
        const document = (documents ?? []).find((item) => item.kind === kind);
        const isUploading = uploading === kind;

        return (
          <View key={kind} style={styles.row}>
            <Ionicons
              name={
                document?.status === 'approved'
                  ? 'checkmark-circle'
                  : document
                    ? 'time-outline'
                    : 'cloud-upload-outline'
              }
              size={22}
              color={document?.status === 'approved' ? '#1b7f3b' : Colors.muted}
            />

            <View style={styles.body}>
              <Text style={styles.label}>{DOCUMENT_LABELS[kind]}</Text>
              <Text style={styles.status}>
                {document ? VERIFICATION_LABELS[document.status] : 'Not uploaded yet'}
              </Text>
              {!!document?.notes && <Text style={styles.notes}>{document.notes}</Text>}
            </View>

            <TouchableOpacity
              style={styles.button}
              disabled={isUploading || submit.isPending}
              onPress={() => onPress(kind)}>
              {isUploading ? (
                <ActivityIndicator size="small" color={Colors.secondary} />
              ) : (
                <Text style={styles.buttonText}>{document ? 'Replace' : 'Upload'}</Text>
              )}
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { gap: 10, width: '100%' },
  loader: { marginVertical: 16 },
  title: { fontSize: 16, fontWeight: '700', color: '#000' },
  hint: { fontSize: 13, color: Colors.muted, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
  },
  body: { flex: 1, gap: 2 },
  label: { fontSize: 14, fontWeight: '600', color: '#000' },
  status: { fontSize: 12, color: Colors.muted },
  notes: { fontSize: 12, color: '#c1272d', marginTop: 2 },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.primaryLight,
    minWidth: 78,
    alignItems: 'center',
  },
  buttonText: { color: Colors.secondary, fontSize: 13, fontWeight: '700' },
});
