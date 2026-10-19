import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AiChatProduct } from "@/lib/ai-chat";

import { AiProductCard } from "./ai-product-card";

const baseProduct: AiChatProduct = {
  id: "p1",
  name: "Napa One",
  slug: "napa-one",
  manufacturer: "Beximco",
  price: 2.51,
  stock: 12,
  inStock: true,
  stockStatus: "IN_STOCK",
  imageUrl: null,
  category: { id: "c1", name: "Pain Relief", slug: "pain-relief" },
  seller: { id: "s1", name: "MediStore", image: null },
  rating: 4.5,
  reviewCount: 10,
};

describe("AiProductCard", () => {
  it("renders verified server fields, a BDT price, and a product link", () => {
    render(<AiProductCard product={baseProduct} />);

    expect(screen.getByText("Napa One")).toBeInTheDocument();
    expect(screen.getByText("Beximco")).toBeInTheDocument();
    expect(screen.getByText("BDT 2.51")).toBeInTheDocument();
    expect(screen.getByText("In stock")).toBeInTheDocument();
    expect(screen.getByText("Pain Relief")).toBeInTheDocument();
    expect(screen.getByText("View product")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/shop/p1");
  });

  it("does not expose any cart controls", () => {
    render(<AiProductCard product={baseProduct} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/add to cart/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/buy now/i)).not.toBeInTheDocument();
  });

  it("shows low-stock and out-of-stock states from server data", () => {
    const { rerender } = render(
      <AiProductCard
        product={{ ...baseProduct, stock: 3, stockStatus: "LOW_STOCK" }}
      />
    );

    expect(screen.getByText("Only 3 left")).toBeInTheDocument();

    rerender(
      <AiProductCard
        product={{
          ...baseProduct,
          stock: 0,
          inStock: false,
          stockStatus: "OUT_OF_STOCK",
        }}
      />
    );

    expect(screen.getByText("Out of stock")).toBeInTheDocument();
  });

  it("uses a neutral fallback when no approved image exists", () => {
    const { container } = render(
      <AiProductCard
        product={{ ...baseProduct, slug: "unknown-product", imageUrl: null }}
      />
    );

    expect(container.querySelector("img")).toBeNull();
  });

  it("renders an approved local image from the shared map", () => {
    render(
      <AiProductCard
        product={{ ...baseProduct, slug: "napa", imageUrl: null }}
      />
    );

    expect(screen.getByAltText("Napa One")).toHaveAttribute(
      "src",
      "/images/medicines/pain-fever-napa.webp"
    );
  });

  it("renders an approved server image", () => {
    render(
      <AiProductCard
        product={{
          ...baseProduct,
          imageUrl:
            "https://res.cloudinary.com/demo/image/upload/v1/napa.png",
        }}
      />
    );

    expect(screen.getByAltText("Napa One")).toHaveAttribute(
      "src",
      "https://res.cloudinary.com/demo/image/upload/v1/napa.png"
    );
  });
});
