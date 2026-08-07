import { Colors } from '@/constants/theme';
import { useCategories } from '@/hooks/useCategories';
import type { CategoryWithCount } from '@/services/categoryService';
import { Image } from 'expo-image';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface CategoryListProps {
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
}

export const CategoryList = ({ selectedCategoryId, onSelectCategory }: CategoryListProps) => {
  const { data: categories, isLoading } = useCategories();

  const renderCategory = ({ item }: { item: CategoryWithCount }) => {
    const isSelected = item.id === selectedCategoryId;
    return (
      <TouchableOpacity
        style={[styles.categoryCard, isSelected && styles.categoryCardSelected]}
        onPress={() => onSelectCategory(isSelected ? null : item.id)}>
        <View style={[styles.categoryImageContainer, { backgroundColor: item.background_color ?? Colors.light }]}>
          <Image source={{ uri: item.image_url ?? undefined }} style={styles.categoryImage} />
        </View>
        <View style={styles.categoryInfo}>
          <Text style={styles.categoryName}>{item.name}</Text>
          <Text style={styles.categoryPlaces}>{item.placesCount} places</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.categoriesSection}>
      <View style={styles.categoriesHeader}>
        <Text style={styles.categoriesTitle}>Categories</Text>
        {selectedCategoryId && (
          <TouchableOpacity style={styles.seeAllButton} onPress={() => onSelectCategory(null)}>
            <Text style={styles.seeAll}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
      {isLoading ? (
        <ActivityIndicator color={Colors.secondary} />
      ) : (
        <FlatList
          horizontal
          data={categories ?? []}
          renderItem={renderCategory}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoriesList}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  categoriesSection: {
    marginBottom: 24,
  },
  categoriesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  categoriesTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginVertical: 6,
  },
  seeAll: {
    fontSize: 14,
    color: Colors.secondary,
    fontWeight: '500',
  },
  seeAllButton: {
    padding: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: Colors.primaryLight,
  },
  categoriesList: {
    gap: 12,
    paddingHorizontal: 16,
  },
  categoryCard: {
    width: 130,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
    marginVertical: 8,
    boxShadow: '0px 4px 2px -2px rgba(0, 0, 0, 0.2)',
    elevation: 2,
  },
  categoryCardSelected: {
    borderWidth: 2,
    borderColor: Colors.secondary,
  },
  categoryImageContainer: {
    padding: 12,
  },
  categoryImage: {
    width: 106,
    height: 106,
    borderRadius: 8,
  },
  categoryInfo: {
    backgroundColor: '#fff',
    padding: 12,
    paddingTop: 4,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light,
  },
  categoryName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  categoryPlaces: {
    fontSize: 12,
    color: Colors.muted,
  },
});
