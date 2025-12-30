/**
 * 第十一批工具调用测试
 * 验证新添加的20个前沿科学工具是否可以被正常调用
 */

const FunctionCaller = require('../ai-engine/function-caller');

async function testBatch11Tools() {
  console.log('========== 第十一批工具调用测试 ==========\n');

  const functionCaller = new FunctionCaller();

  // 获取所有可用工具
  const allTools = functionCaller.getAvailableTools();
  const batch11Tools = allTools.filter(tool => {
    const toolNumber = parseInt(tool.name.match(/\d+$/)?.[0] || '0');
    return toolNumber >= 217 && toolNumber <= 236;
  });

  console.log(`✅ 已注册的第十一批工具数量: ${batch11Tools.length}/20\n`);

  // 测试案例
  const testCases = [
    {
      name: 'LIGO数据分析器',
      toolName: 'ligo_data_analyzer',
      params: {
        detector: 'LIGO-Hanford',
        data_segment: {
          start_gps: 1126259462, // GW150914事件
          duration: 4
        },
        preprocessing: {
          whitening: true,
          bandpass: { low_freq: 20, high_freq: 500 }
        },
        analysis_method: 'matched_filter'
      }
    },
    {
      name: '粒子碰撞模拟器',
      toolName: 'particle_simulator',
      params: {
        collider: 'LHC',
        collision_energy: 13,
        beam_particles: {
          particle1: 'proton',
          particle2: 'proton'
        },
        process: 'Higgs_production',
        num_events: 100
      }
    },
    {
      name: 'WIMP探测器',
      toolName: 'wimp_detector',
      params: {
        detector_type: 'xenon_TPC',
        target_material: 'Xe',
        exposure: {
          mass_kg: 1000,
          time_days: 365
        },
        energy_threshold: 1.0,
        wimp_params: {
          mass_gev: 100,
          cross_section: 1e-45
        }
      }
    },
    {
      name: '托卡马克模拟器',
      toolName: 'tokamak_simulator',
      params: {
        device: 'ITER',
        plasma_params: {
          major_radius: 6.2,
          minor_radius: 2.0,
          toroidal_field: 5.3,
          plasma_current: 15
        },
        operating_scenario: 'H-mode',
        heating_systems: {
          nbi_power: 33,
          ec_power: 20,
          ic_power: 20
        },
        simulation_type: 'equilibrium'
      }
    },
    {
      name: '光子路由器',
      toolName: 'photonic_router',
      params: {
        architecture: 'wavelength_routing',
        wavelength_channels: 40,
        switching_technology: 'SOA',
        modulation_format: 'QPSK',
        routing_table: [
          { source: 'A', destination: 'B', wavelength: 0 },
          { source: 'B', destination: 'C', wavelength: 1 }
        ]
      }
    },
    {
      name: '拓扑态计算器',
      toolName: 'topological_state_calculator',
      params: {
        material: {
          lattice: 'honeycomb',
          symmetry: 'C6v'
        },
        topological_invariant: 'chern_number',
        k_points: {
          path: ['Γ', 'K', 'M', 'Γ']
        },
        calculation_method: 'berry_curvature'
      }
    },
    {
      name: '冰芯分析器',
      toolName: 'ice_core_analyzer',
      params: {
        core_info: {
          location: 'Antarctica',
          depth_m: 3270,
          age_ka: 800
        },
        analysis_types: ['isotope', 'greenhouse_gas'],
        isotope_ratios: {
          delta_O18: true,
          delta_D: true
        },
        gas_measurements: {
          CO2: true,
          CH4: true
        },
        resolution: 10,
        dating_method: 'layer_counting'
      }
    },
    {
      name: '岩浆模拟器',
      toolName: 'magma_simulator',
      params: {
        volcano_type: 'stratovolcano',
        magma_properties: {
          composition: 'andesitic',
          temperature_c: 1000,
          viscosity: 10000,
          volatile_content: {
            H2O_wt: 3,
            SO2_ppm: 200
          }
        },
        chamber_geometry: {
          depth_km: 5,
          volume_km3: 10,
          shape: 'ellipsoidal'
        },
        simulation_type: 'eruption'
      }
    },
    {
      name: '放射性碳测年器',
      toolName: 'radiocarbon_dater',
      params: {
        sample_info: {
          material_type: 'wood',
          mass_mg: 5,
          pretreatment: 'acid_alkali_acid'
        },
        measurement_method: 'AMS',
        c14_measurement: {
          fraction_modern: 0.5,
          uncertainty: 0.003,
          delta_c13: -25
        },
        calibration_curve: 'IntCal20'
      }
    },
    {
      name: '柔性传感器设计器',
      toolName: 'flexible_sensor_designer',
      params: {
        sensor_type: 'strain',
        substrate: {
          material: 'PI',
          thickness_um: 50,
          flexibility: 'stretchable'
        },
        active_material: {
          type: 'graphene',
          deposition_method: 'inkjet'
        },
        design_parameters: {
          sensing_area_mm2: 100,
          electrode_pattern: 'interdigitated',
          target_sensitivity: 100
        },
        application: 'health_monitoring'
      }
    }
  ];

  console.log('开始测试工具调用...\n');

  let successCount = 0;
  let failCount = 0;

  for (const testCase of testCases) {
    try {
      console.log(`📝 测试: ${testCase.name} (${testCase.toolName})`);

      const result = await functionCaller.call(testCase.toolName, testCase.params);

      if (result.success) {
        console.log(`   ✅ 成功!`);
        // 显示部分结果
        const keys = Object.keys(result).filter(k => k !== 'success' && k !== 'error').slice(0, 3);
        keys.forEach(key => {
          const value = result[key];
          const displayValue = typeof value === 'object' ? JSON.stringify(value).substring(0, 50) + '...' : value;
          console.log(`   → ${key}: ${displayValue}`);
        });
        successCount++;
      } else {
        console.log(`   ❌ 失败: ${result.error}`);
        failCount++;
      }
    } catch (error) {
      console.log(`   ❌ 异常: ${error.message}`);
      failCount++;
    }
    console.log('');
  }

  console.log('========== 测试结果汇总 ==========');
  console.log(`总测试数: ${testCases.length}`);
  console.log(`成功: ${successCount}`);
  console.log(`失败: ${failCount}`);
  console.log(`成功率: ${(successCount / testCases.length * 100).toFixed(1)}%`);
  console.log('================================\n');

  // 列出所有第十一批工具
  console.log('========== 第十一批工具列表 ==========');
  const batch11ToolNames = [
    'ligo_data_analyzer',
    'waveform_matcher',
    'particle_simulator',
    'event_generator',
    'wimp_detector',
    'axion_searcher',
    'tokamak_simulator',
    'plasma_controller',
    'photonic_router',
    'optical_nn_designer',
    'topological_state_calculator',
    'majorana_detector',
    'ice_core_analyzer',
    'climate_reconstructor',
    'magma_simulator',
    'volcanic_monitor',
    'radiocarbon_dater',
    'artifact_reconstructor',
    'flexible_sensor_designer',
    'biochip_analyzer'
  ];

  batch11ToolNames.forEach((toolName, index) => {
    const tool = allTools.find(t => t.name === toolName);
    if (tool) {
      console.log(`${index + 1}. ✅ ${tool.name} - ${tool.description}`);
    } else {
      console.log(`${index + 1}. ❌ ${toolName} - 未注册`);
    }
  });

  console.log('================================\n');

  return {
    total: testCases.length,
    success: successCount,
    failed: failCount
  };
}

// 运行测试
if (require.main === module) {
  testBatch11Tools()
    .then((result) => {
      if (result.failed === 0) {
        console.log('🎉 所有工具测试通过!');
        process.exit(0);
      } else {
        console.log('⚠️ 部分工具测试失败');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('测试执行失败:', error);
      process.exit(1);
    });
}

module.exports = { testBatch11Tools };
