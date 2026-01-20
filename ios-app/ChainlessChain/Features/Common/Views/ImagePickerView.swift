import SwiftUI
import PhotosUI

/// 图片选择器视图
/// 支持相册选择和相机拍照
struct ImagePickerView: View {
    @Binding var selectedImages: [UIImage]
    @Binding var isPresented: Bool

    var maxSelection: Int = 9
    var allowsEditing: Bool = true
    var showCamera: Bool = true
    var onComplete: (([UIImage]) -> Void)?

    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var showingCamera = false
    @State private var showingImageCropper = false
    @State private var imageToEdit: UIImage?
    @State private var isLoading = false

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Selected images preview
                if !selectedImages.isEmpty {
                    selectedImagesPreview
                }

                // Selection options
                VStack(spacing: 16) {
                    // Photo library picker
                    PhotosPicker(
                        selection: $selectedItems,
                        maxSelectionCount: maxSelection - selectedImages.count,
                        matching: .images,
                        photoLibrary: .shared()
                    ) {
                        HStack {
                            Image(systemName: "photo.on.rectangle")
                                .font(.title2)
                            Text("从相册选择")
                                .font(.headline)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.gray)
                        }
                        .padding()
                        .background(Color(.secondarySystemGroupedBackground))
                        .cornerRadius(12)
                    }
                    .onChange(of: selectedItems) { newItems in
                        Task {
                            await loadSelectedImages(from: newItems)
                        }
                    }

                    // Camera button
                    if showCamera {
                        Button(action: { showingCamera = true }) {
                            HStack {
                                Image(systemName: "camera")
                                    .font(.title2)
                                Text("拍照")
                                    .font(.headline)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .foregroundColor(.gray)
                            }
                            .padding()
                            .background(Color(.secondarySystemGroupedBackground))
                            .cornerRadius(12)
                        }
                    }
                }
                .padding()

                Spacer()

                // Loading indicator
                if isLoading {
                    ProgressView("加载中...")
                        .padding()
                }

                // Confirm button
                if !selectedImages.isEmpty {
                    Button(action: confirmSelection) {
                        Text("确认选择 (\(selectedImages.count))")
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue)
                            .cornerRadius(12)
                    }
                    .padding()
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("选择图片")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        isPresented = false
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    if !selectedImages.isEmpty {
                        Button("清除") {
                            selectedImages.removeAll()
                            selectedItems.removeAll()
                        }
                    }
                }
            }
            .sheet(isPresented: $showingCamera) {
                CameraView(image: $imageToEdit, isPresented: $showingCamera)
                    .onChange(of: imageToEdit) { newImage in
                        if let image = newImage {
                            if allowsEditing {
                                showingImageCropper = true
                            } else {
                                selectedImages.append(image)
                            }
                        }
                    }
            }
            .sheet(isPresented: $showingImageCropper) {
                if let image = imageToEdit {
                    ImageCropperView(image: image, isPresented: $showingImageCropper) { croppedImage in
                        selectedImages.append(croppedImage)
                        imageToEdit = nil
                    }
                }
            }
        }
    }

    // MARK: - Selected Images Preview

    private var selectedImagesPreview: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(Array(selectedImages.enumerated()), id: \.offset) { index, image in
                    ZStack(alignment: .topTrailing) {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 80, height: 80)
                            .clipShape(RoundedRectangle(cornerRadius: 8))

                        // Delete button
                        Button(action: {
                            withAnimation {
                                selectedImages.remove(at: index)
                            }
                        }) {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(.white)
                                .background(Color.black.opacity(0.5))
                                .clipShape(Circle())
                        }
                        .offset(x: 8, y: -8)
                    }
                }
            }
            .padding()
        }
        .frame(height: 100)
        .background(Color(.secondarySystemGroupedBackground))
    }

    // MARK: - Load Images

    @MainActor
    private func loadSelectedImages(from items: [PhotosPickerItem]) async {
        isLoading = true
        defer { isLoading = false }

        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self),
               let image = UIImage(data: data) {
                // Compress if too large
                let compressedImage = compressImageIfNeeded(image)
                selectedImages.append(compressedImage)
            }
        }

        selectedItems.removeAll()
    }

    private func compressImageIfNeeded(_ image: UIImage) -> UIImage {
        let maxDimension: CGFloat = 1920
        let size = image.size

        if size.width <= maxDimension && size.height <= maxDimension {
            return image
        }

        let scale = maxDimension / max(size.width, size.height)
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)

        UIGraphicsBeginImageContextWithOptions(newSize, false, 1.0)
        image.draw(in: CGRect(origin: .zero, size: newSize))
        let resizedImage = UIGraphicsGetImageFromCurrentImageContext() ?? image
        UIGraphicsEndImageContext()

        return resizedImage
    }

    private func confirmSelection() {
        onComplete?(selectedImages)
        isPresented = false
    }
}

// MARK: - Camera View

struct CameraView: UIViewControllerRepresentable {
    @Binding var image: UIImage?
    @Binding var isPresented: Bool

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraView

        init(_ parent: CameraView) {
            self.parent = parent
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                parent.image = image
            }
            parent.isPresented = false
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.isPresented = false
        }
    }
}

// MARK: - Image Cropper View

struct ImageCropperView: View {
    let image: UIImage
    @Binding var isPresented: Bool
    var onCrop: (UIImage) -> Void

    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        NavigationView {
            GeometryReader { geometry in
                ZStack {
                    Color.black.edgesIgnoringSafeArea(.all)

                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .scaleEffect(scale)
                        .offset(offset)
                        .gesture(
                            MagnificationGesture()
                                .onChanged { value in
                                    scale = lastScale * value
                                }
                                .onEnded { _ in
                                    lastScale = scale
                                    // Limit scale
                                    if scale < 1.0 {
                                        withAnimation {
                                            scale = 1.0
                                            lastScale = 1.0
                                        }
                                    } else if scale > 4.0 {
                                        withAnimation {
                                            scale = 4.0
                                            lastScale = 4.0
                                        }
                                    }
                                }
                        )
                        .simultaneousGesture(
                            DragGesture()
                                .onChanged { value in
                                    offset = CGSize(
                                        width: lastOffset.width + value.translation.width,
                                        height: lastOffset.height + value.translation.height
                                    )
                                }
                                .onEnded { _ in
                                    lastOffset = offset
                                }
                        )
                }
            }
            .navigationTitle("裁剪图片")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        isPresented = false
                    }
                    .foregroundColor(.white)
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") {
                        // For now, just use the original image
                        // In production, would implement actual cropping
                        onCrop(image)
                        isPresented = false
                    }
                    .foregroundColor(.white)
                }
            }
            .toolbarBackground(.black, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}

// MARK: - Compact Image Picker Button

struct ImagePickerButton: View {
    @Binding var selectedImages: [UIImage]
    var maxSelection: Int = 9
    var onComplete: (([UIImage]) -> Void)?

    @State private var showingPicker = false

    var body: some View {
        Button(action: { showingPicker = true }) {
            HStack(spacing: 4) {
                Image(systemName: "photo")
                if !selectedImages.isEmpty {
                    Text("\(selectedImages.count)")
                        .font(.caption)
                }
            }
            .foregroundColor(.blue)
            .padding(8)
            .background(Color.blue.opacity(0.1))
            .cornerRadius(8)
        }
        .sheet(isPresented: $showingPicker) {
            ImagePickerView(
                selectedImages: $selectedImages,
                isPresented: $showingPicker,
                maxSelection: maxSelection,
                onComplete: onComplete
            )
        }
    }
}

// MARK: - Image Grid View

struct ImageGridView: View {
    let images: [UIImage]
    var maxDisplayCount: Int = 4
    var spacing: CGFloat = 4
    var onTap: ((Int) -> Void)?

    var body: some View {
        let displayImages = Array(images.prefix(maxDisplayCount))
        let remainingCount = images.count - maxDisplayCount

        LazyVGrid(columns: gridColumns, spacing: spacing) {
            ForEach(Array(displayImages.enumerated()), id: \.offset) { index, image in
                ZStack {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(minWidth: 0, maxWidth: .infinity, minHeight: 80, maxHeight: 120)
                        .clipped()
                        .cornerRadius(8)

                    // Show remaining count on last image
                    if index == maxDisplayCount - 1 && remainingCount > 0 {
                        Color.black.opacity(0.5)
                            .cornerRadius(8)

                        Text("+\(remainingCount)")
                            .font(.title2)
                            .fontWeight(.bold)
                            .foregroundColor(.white)
                    }
                }
                .onTapGesture {
                    onTap?(index)
                }
            }
        }
    }

    private var gridColumns: [GridItem] {
        let count = min(images.count, maxDisplayCount)
        switch count {
        case 1:
            return [GridItem(.flexible())]
        case 2:
            return [GridItem(.flexible()), GridItem(.flexible())]
        default:
            return [GridItem(.flexible()), GridItem(.flexible())]
        }
    }
}

// MARK: - Full Screen Image Viewer

struct FullScreenImageViewer: View {
    let images: [UIImage]
    @Binding var selectedIndex: Int
    @Binding var isPresented: Bool

    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0

    var body: some View {
        ZStack {
            Color.black.edgesIgnoringSafeArea(.all)

            TabView(selection: $selectedIndex) {
                ForEach(Array(images.enumerated()), id: \.offset) { index, image in
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .scaleEffect(scale)
                        .gesture(
                            MagnificationGesture()
                                .onChanged { value in
                                    scale = lastScale * value
                                }
                                .onEnded { _ in
                                    lastScale = scale
                                    if scale < 1.0 {
                                        withAnimation {
                                            scale = 1.0
                                            lastScale = 1.0
                                        }
                                    }
                                }
                        )
                        .onTapGesture(count: 2) {
                            withAnimation {
                                if scale > 1 {
                                    scale = 1.0
                                    lastScale = 1.0
                                } else {
                                    scale = 2.0
                                    lastScale = 2.0
                                }
                            }
                        }
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .automatic))

            // Close button
            VStack {
                HStack {
                    Spacer()
                    Button(action: { isPresented = false }) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title)
                            .foregroundColor(.white)
                            .padding()
                    }
                }
                Spacer()

                // Image counter
                Text("\(selectedIndex + 1) / \(images.count)")
                    .foregroundColor(.white)
                    .padding(8)
                    .background(Color.black.opacity(0.5))
                    .cornerRadius(8)
                    .padding(.bottom)
            }
        }
        .statusBar(hidden: true)
    }
}

#Preview {
    @Previewable @State var images: [UIImage] = []
    @Previewable @State var isPresented = true

    ImagePickerView(selectedImages: $images, isPresented: $isPresented)
}
