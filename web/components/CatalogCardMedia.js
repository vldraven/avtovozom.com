import CatalogCardImageScrub from "./CatalogCardImageScrub";
import ListingFavoriteButton from "./ListingFavoriteButton";

/**
 * Превью в карточке каталога: фото + избранное в углу (как auto.ru).
 */
export default function CatalogCardMedia({ photos, carId, car = null, imagePriority = false }) {
  return (
    <div className="catalog-card__image-area">
      <CatalogCardImageScrub photos={photos} priority={imagePriority} />
      <ListingFavoriteButton carId={carId} car={car} variant="overlay" />
    </div>
  );
}
