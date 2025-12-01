package com.chainlesschain.ui.fragment;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.chainlesschain.R;
import com.chainlesschain.ui.KnowledgeEditActivity;
import com.chainlesschain.ui.adapter.KnowledgeAdapter;
import com.chainlesschain.viewmodel.KnowledgeViewModel;
import com.google.android.material.floatingactionbutton.FloatingActionButton;

/**
 * Knowledge Fragment
 * 知识库列表Fragment
 */
public class KnowledgeFragment extends Fragment {

    private RecyclerView recyclerView;
    private KnowledgeAdapter adapter;
    private SwipeRefreshLayout swipeRefresh;
    private EditText etSearch;
    private FloatingActionButton fabAdd;

    private KnowledgeViewModel viewModel;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_knowledge, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        initViews(view);
        initViewModel();
        setupRecyclerView();
        setupSearch();
    }

    private void initViews(View view) {
        recyclerView = view.findViewById(R.id.recycler_view);
        swipeRefresh = view.findViewById(R.id.swipe_refresh);
        etSearch = view.findViewById(R.id.et_search);
        fabAdd = view.findViewById(R.id.fab_add);

        fabAdd.setOnClickListener(v -> {
            Intent intent = new Intent(getActivity(), KnowledgeEditActivity.class);
            startActivity(intent);
        });

        swipeRefresh.setOnRefreshListener(() -> {
            viewModel.refreshItems();
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                swipeRefresh.setRefreshing(false);
            }, 1000);
        });
    }

    private void initViewModel() {
        viewModel = new ViewModelProvider(this).get(KnowledgeViewModel.class);

        // 观察数据变化
        viewModel.getItems().observe(getViewLifecycleOwner(), items -> {
            if (adapter != null) {
                adapter.setItems(items);
            }
        });
    }

    private void setupRecyclerView() {
        adapter = new KnowledgeAdapter();
        recyclerView.setLayoutManager(new LinearLayoutManager(getContext()));
        recyclerView.setAdapter(adapter);

        // 点击事件处理
        adapter.setOnItemClickListener(item -> {
            // TODO: 跳转到详情页面
        });
    }

    private void setupSearch() {
        etSearch.addTextChangedListener(new TextWatcher() {
            private Handler handler = new Handler(Looper.getMainLooper());
            private Runnable searchRunnable;

            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                if (searchRunnable != null) {
                    handler.removeCallbacks(searchRunnable);
                }
            }

            @Override
            public void afterTextChanged(Editable s) {
                searchRunnable = () -> {
                    String query = s.toString().trim();
                    if (query.isEmpty()) {
                        viewModel.refreshItems();
                    } else {
                        viewModel.searchItems(query);
                    }
                };
                handler.postDelayed(searchRunnable, 300);
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        viewModel.refreshItems();
    }
}
