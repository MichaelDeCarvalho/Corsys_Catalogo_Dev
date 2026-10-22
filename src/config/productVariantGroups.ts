/**
 * Configuração Comercial das Famílias e Grupos de Variações — CORSYS.CATÁLOGO
 *
 * AUTORIDADE COMERCIAL EXCLUSIVA:
 * - Define unicamente os grupos comerciais expressamente aprovados (G01 a G84).
 * - PROIBIDO persistir preços, estoques, custos ou identificadores internos aqui.
 * - Todos os valores comerciais reais são sempre obtidos do Product carregado do Supabase.
 * - Itens individuais sem par comercial aprovado (CU012, CU013, RB008) permanecem simples.
 */

export interface ProductVariantGroupConfig {
  groupId: string;
  displayName: string;
  variantType: string;
  skus: string[];
}

export const PRODUCT_VARIANT_GROUPS: ProductVariantGroupConfig[] = [
  // --------------------------------------------------
  // FIXAÇÃO E ELÉTRICA
  // --------------------------------------------------
  {
    groupId: 'G01',
    displayName: 'ABRAÇADEIRA DE NYLON',
    variantType: 'medida',
    skus: ['AB001', 'AB002', 'AB003', 'AB004'],
  },
  {
    groupId: 'G02',
    displayName: 'BUCHA FU PLÁSTICA',
    variantType: 'número',
    skus: ['BC001', 'BC002'],
  },
  {
    groupId: 'G03',
    displayName: 'PARAFUSO 1/4',
    variantType: 'medida',
    skus: ['PF001', 'PF002'],
  },
  {
    groupId: 'G04',
    displayName: 'PARAFUSO CHATA',
    variantType: 'medida',
    skus: ['PF003', 'PF004', 'PF005', 'PF006', 'PF007', 'PF008', 'PF009'],
  },
  {
    groupId: 'G05',
    displayName: 'PARAFUSO PANELA',
    variantType: 'medida',
    skus: ['PF010', 'PF011', 'PF012', 'PF013'],
  },
  {
    groupId: 'G06',
    displayName: 'PINO MACHO',
    variantType: 'amperagem',
    skus: ['PN001', 'PN002'],
  },
  {
    groupId: 'G07',
    displayName: 'PLUG FÊMEA',
    variantType: 'amperagem',
    skus: ['PG001', 'PG002'],
  },

  // --------------------------------------------------
  // FERRAMENTAS MANUAIS
  // --------------------------------------------------
  {
    groupId: 'G08',
    displayName: 'ALICATE',
    variantType: 'modelo/medida',
    skus: ['AL002', 'AL003'],
  },
  {
    groupId: 'G09',
    displayName: 'CANTONEIRA',
    variantType: 'comprimento',
    skus: ['CN001', 'CN002', 'CN003'],
  },
  {
    groupId: 'G10',
    displayName: 'CHAVE INGLESA',
    variantType: 'tamanho',
    skus: ['CH002', 'CH003', 'CH004'],
  },
  {
    groupId: 'G11',
    displayName: 'ESPÁTULA DE AÇO LISA',
    variantType: 'largura',
    skus: ['EP001', 'EP002', 'EP003'],
  },
  {
    groupId: 'G12',
    displayName: 'ESQUADRO CABO ALUMÍNIO',
    variantType: 'tamanho',
    skus: ['EQ001', 'EQ002'],
  },
  {
    groupId: 'G13',
    displayName: 'MÃO FRANCESA',
    variantType: 'comprimento',
    skus: ['MF001', 'MF002', 'MF003', 'MF004', 'MF005', 'MF006', 'MF007'],
  },
  {
    groupId: 'G14',
    displayName: 'MARTELO CABO FIBRA',
    variantType: 'medida',
    skus: ['MA003', 'MA004'],
  },
  {
    groupId: 'G15',
    displayName: 'MARTELO DE BORRACHA PRETO',
    variantType: 'medida',
    skus: ['MA005', 'MA006'],
  },
  {
    groupId: 'G16',
    displayName: 'SARGENTO',
    variantType: 'modelo/tamanho',
    skus: ['SG001', 'SG002'],
  },
  {
    groupId: 'G17',
    displayName: 'TORQUES ARMADOR',
    variantType: 'tamanho',
    skus: ['TA001', 'TA002', 'TA003'],
  },
  {
    groupId: 'G18',
    displayName: 'TRENA HIZAR',
    variantType: 'comprimento',
    skus: ['TR004', 'TR005'],
  },

  // --------------------------------------------------
  // BROCAS
  // --------------------------------------------------
  {
    groupId: 'G19',
    displayName: 'BITS PARA PARAFUSADEIRA',
    variantType: 'comprimento',
    skus: ['BT001', 'BT002', 'BT003', 'BT004', 'BT005'],
  },
  {
    groupId: 'G20',
    displayName: 'BROCA CERÂMICA/PORCELANATO',
    variantType: 'diâmetro',
    skus: [
      'BR021', 'BR022', 'BR023', 'BR024', 'BR025', 'BR026', 'BR027', 'BR028', 'BR029',
      'BR030', 'BR031', 'BR032', 'BR033', 'BR034', 'BR035', 'BR036', 'BR037', 'BR038',
    ],
  },
  {
    groupId: 'G21',
    displayName: 'BROCA CHATA',
    variantType: 'medida',
    skus: ['BR039', 'BR040', 'BR041', 'BR042', 'BR043', 'BR044', 'BR045'],
  },
  {
    groupId: 'G22',
    displayName: 'BROCA CÔNICA',
    variantType: 'modelo/medida/grão',
    skus: ['BR046', 'BR047', 'BR048', 'BR049'],
  },
  {
    groupId: 'G23',
    displayName: 'BROCA DE VIDEA',
    variantType: 'medida',
    skus: ['BR050', 'BR051', 'BR052', 'BR053', 'BR054', 'BR055', 'BR056', 'BR057'],
  },
  {
    groupId: 'G24',
    displayName: 'BROCA DE VIDEA SDS / SDS PLUS',
    variantType: 'medida',
    skus: ['BR058', 'BR059', 'BR060', 'BR061', 'BR062', 'BR063'],
  },
  {
    groupId: 'G25',
    displayName: 'BROCA DIAMANTADA',
    variantType: 'diâmetro',
    skus: [
      'BR001', 'BR002', 'BR003', 'BR004', 'BR005', 'BR006', 'BR007', 'BR008', 'BR009',
      'BR010', 'BR011', 'BR012', 'BR013', 'BR014', 'BR015', 'BR016', 'BR017', 'BR018',
      'BR019', 'BR020',
    ],
  },
  {
    groupId: 'G26',
    displayName: 'BROCA ESCALONADA HSS',
    variantType: 'faixa de medida',
    skus: ['BR064', 'BR065'],
  },
  {
    groupId: 'G27',
    displayName: 'BROCA HSS AÇO RÁPIDO',
    variantType: 'medida',
    skus: [
      'BR066', 'BR067', 'BR068', 'BR069', 'BR070', 'BR071', 'BR072', 'BR073', 'BR074',
      'BR075', 'BR076', 'BR077', 'BR078', 'BR079', 'BR080', 'BR081', 'BR082', 'BR083',
      'BR084', 'BR085', 'BR086', 'BR087', 'BR088', 'BR089', 'BR090',
    ],
  },
  {
    groupId: 'G28',
    displayName: 'BROCA MOURÃO',
    variantType: 'medida',
    skus: ['BR091', 'BR092'],
  },
  {
    groupId: 'G29',
    displayName: 'BROCA MOURÃO ROLL FORGED',
    variantType: 'medida',
    skus: ['BR093', 'BR094'],
  },
  {
    groupId: 'G30',
    displayName: 'BROCA PARA AÇO TRAMONTINA',
    variantType: 'medida',
    skus: ['BR095', 'BR096'],
  },
  {
    groupId: 'G31',
    displayName: 'BROCA PARA MADEIRA 3 PONTAS',
    variantType: 'medida',
    skus: ['BR099', 'BR100', 'BR101', 'BR102', 'BR103'],
  },
  {
    groupId: 'G32',
    displayName: 'BROCA VIDEA LONGA',
    variantType: 'medida',
    skus: ['BR104', 'BR105', 'BR106', 'BR107'],
  },

  // --------------------------------------------------
  // EPIs
  // --------------------------------------------------
  {
    groupId: 'G33',
    displayName: 'BOTA COM BIQUEIRA DE AÇO',
    variantType: 'numeração',
    skus: ['BO001', 'BO002', 'BO003', 'BO004'],
  },
  {
    groupId: 'G34',
    displayName: 'BOTA SEM BIQUEIRA DE AÇO',
    variantType: 'numeração',
    skus: ['BO005', 'BO006', 'BO007', 'BO008', 'BO009'],
  },
  {
    groupId: 'G35',
    displayName: 'BOTA SEM BIQUEIRA SEM FORRO',
    variantType: 'numeração',
    skus: ['BO010', 'BO011'],
  },
  {
    groupId: 'G36',
    displayName: 'BOTINA DE COURO COM BICO DE AÇO',
    variantType: 'numeração',
    skus: ['BO012', 'BO013', 'BO014', 'BO015', 'BO016'],
  },

  // --------------------------------------------------
  // CUBAS E TANQUES
  // --------------------------------------------------
  {
    groupId: 'G37',
    displayName: 'CUBA AÇO 430',
    variantType: 'dimensões',
    skus: ['CU001', 'CU002', 'CU003', 'CU004', 'CU005', 'CU006', 'CU007'],
  },
  {
    groupId: 'G38',
    displayName: 'CUBA DE LOUÇA OVAL INCEPA',
    variantType: 'dimensões',
    skus: ['CU008', 'CU009'],
  },
  {
    groupId: 'G39',
    displayName: 'CUBA GOURMET COM ACESSÓRIOS',
    variantType: 'dimensões',
    skus: ['CU010', 'CU011'],
  },
  {
    groupId: 'G40',
    displayName: 'CUBA REDONDA',
    variantType: 'dimensão/material',
    skus: ['CU014', 'CU015'],
  },
  {
    groupId: 'G41',
    displayName: 'TANQUE',
    variantType: 'dimensão/material',
    skus: ['TQ001', 'TQ002', 'TQ003'],
  },
  {
    groupId: 'G42',
    displayName: 'TANQUE ESCOVADO',
    variantType: 'dimensões',
    skus: ['TQ004', 'TQ005', 'TQ006'],
  },

  // --------------------------------------------------
  // DISCOS E SERRAS
  // --------------------------------------------------
  {
    groupId: 'G43',
    displayName: 'DISCO DE CORTE PARA AÇO INOX',
    variantType: 'diâmetro',
    skus: ['DS018', 'DS019', 'DS020'],
  },
  {
    groupId: 'G44',
    displayName: 'DISCO DE DESBASTE ACABAMENTO 100MM C/R',
    variantType: 'grão',
    skus: ['DS004', 'DS005'],
  },
  {
    groupId: 'G45',
    displayName: 'DISCO PARA VIDRO CRISTAL',
    variantType: 'medida',
    skus: ['DS027', 'DS028'],
  },
  {
    groupId: 'G46',
    displayName: 'FLAP K',
    variantType: 'grão',
    skus: ['FL001', 'FL002', 'FL003', 'FL004', 'FL005'],
  },
  {
    groupId: 'G47',
    displayName: 'SERRA WIDEA PARA MADEIRA',
    variantType: 'diâmetro',
    skus: ['SR020', 'SR021'],
  },

  // --------------------------------------------------
  // REBOLOS E ABRASIVOS
  // --------------------------------------------------
  {
    groupId: 'G48',
    displayName: 'ESCOVA ABRASIVA DE CARBETO',
    variantType: 'grão',
    skus: ['EC001', 'EC002', 'EC003', 'EC004', 'EC005'],
  },
  {
    groupId: 'G49',
    displayName: 'ESCOVA COPO ONDULADA',
    variantType: 'tamanho',
    skus: ['EC007', 'EC008', 'EC009'],
  },
  {
    groupId: 'G50',
    displayName: 'ESCOVA COPO TRANÇADA',
    variantType: 'tamanho',
    skus: ['EC010', 'EC011', 'EC012'],
  },
  {
    groupId: 'G51',
    displayName: 'ESCOVA DE AÇO CIRCULAR ONDULADA',
    variantType: 'medida',
    skus: ['EC014', 'EC015', 'EC016', 'EC017', 'EC018'],
  },
  {
    groupId: 'G52',
    displayName: 'ESCOVA DE AÇO CIRCULAR TRANÇADA',
    variantType: 'medida',
    skus: ['EC019', 'EC020'],
  },
  {
    groupId: 'G53',
    displayName: 'ESCOVA DIAMANTADA',
    variantType: 'grão',
    skus: ['EC021', 'EC022'],
  },
  {
    groupId: 'G54',
    displayName: 'PALHA DE AÇO',
    variantType: 'número',
    skus: ['PL001', 'PL002'],
  },
  {
    groupId: 'G55',
    displayName: 'REBOLO CÔNICO 4" C/R',
    variantType: 'grão',
    skus: ['RB001', 'RB004', 'RB005', 'RB006'],
  },
  {
    groupId: 'G56',
    displayName: 'REBOLO CÔNICO 5" C/R',
    variantType: 'grão',
    skus: ['RB002', 'RB003'],
  },
  {
    groupId: 'G57',
    displayName: 'REBOLO DE REBAIXO PARA VÁLVULA',
    variantType: 'grão',
    skus: ['RB009', 'RB010', 'RB011', 'RB012'],
  },
  {
    groupId: 'G58',
    displayName: 'REBOLO RETO C/R',
    variantType: 'grão',
    skus: ['RB013', 'RB014'],
  },

  // --------------------------------------------------
  // LIXAS
  // --------------------------------------------------
  {
    groupId: 'G59',
    displayName: 'LIXA 5 PASSOS',
    variantType: 'passo',
    skus: ['LX001', 'LX002', 'LX003', 'LX004', 'LX005'],
  },
  {
    groupId: 'G60',
    displayName: 'LIXA DIAMANTADA BUFF',
    variantType: 'cor',
    skus: ['LX006', 'LX007'],
  },
  {
    groupId: 'G61',
    displayName: 'LIXA DIAMANTADA D\'ÁGUA 125MM',
    variantType: 'grão',
    skus: ['LX008', 'LX009', 'LX010', 'LX011', 'LX012', 'LX013', 'LX014'],
  },
  {
    groupId: 'G62',
    displayName: 'LIXA DIAMANTADA ECO BRANCA',
    variantType: 'grão',
    skus: ['LX015', 'LX016', 'LX017', 'LX018', 'LX019', 'LX020', 'LX021'],
  },
  {
    groupId: 'G63',
    displayName: 'LIXA DIAMANTADA ECO COLORIDA',
    variantType: 'grão',
    skus: ['LX022', 'LX023', 'LX024', 'LX025', 'LX026', 'LX027', 'LX028'],
  },
  {
    groupId: 'G64',
    displayName: 'LIXA DIAMANTADA HÍBRIDA',
    variantType: 'grão',
    skus: ['LX029', 'LX030', 'LX031', 'LX032', 'LX033', 'LX034', 'LX035'],
  },
  {
    groupId: 'G65',
    displayName: 'LIXA DIAMANTADA PRÓ BRANCA',
    variantType: 'grão',
    skus: ['LX036', 'LX037', 'LX038', 'LX039', 'LX040', 'LX041', 'LX042'],
  },
  {
    groupId: 'G66',
    displayName: 'LIXA DIAMANTADA PRÓ COLORIDA',
    variantType: 'grão',
    skus: ['LX043', 'LX044', 'LX045', 'LX046', 'LX047', 'LX048', 'LX049'],
  },
  {
    groupId: 'G67',
    displayName: 'LIXA DIAMANTADA TRÊS PASSOS COLMEIA',
    variantType: 'passo',
    skus: ['LX050', 'LX051', 'LX052'],
  },
  {
    groupId: 'G68',
    displayName: 'LIXA DIAMANTADA TRÊS PASSOS ESTRELA',
    variantType: 'passo',
    skus: ['LX053', 'LX054', 'LX055'],
  },
  {
    groupId: 'G69',
    displayName: 'LIXA DURITE',
    variantType: 'grão',
    skus: ['LX057', 'LX058', 'LX059', 'LX060'],
  },
  {
    groupId: 'G70',
    displayName: 'LIXA FLOWER',
    variantType: 'número/passo',
    skus: ['LX061', 'LX062', 'LX063'],
  },
  {
    groupId: 'G71',
    displayName: 'LIXA TAMBOR DIAMANTADA',
    variantType: 'grão',
    skus: ['LX064', 'LX065', 'LX066', 'LX067', 'LX068', 'LX069', 'LX083'],
  },
  {
    groupId: 'G72',
    displayName: 'LIXA VELCRO',
    variantType: 'grão',
    skus: ['LX071', 'LX073', 'LX075', 'LX077', 'LX079', 'LX081'],
  },
  {
    groupId: 'G73',
    displayName: 'LIXA VELCRO SAIT',
    variantType: 'grão',
    skus: ['LX072', 'LX074', 'LX076', 'LX078', 'LX080', 'LX082'],
  },

  // --------------------------------------------------
  // QUÍMICOS E ADESIVOS
  // --------------------------------------------------
  {
    groupId: 'G74',
    displayName: 'MASSA PLÁSTICA 800G',
    variantType: 'cor',
    skus: ['MP002', 'MP003', 'MP004', 'MP005'],
  },
  {
    groupId: 'G75',
    displayName: 'PU ARGACON',
    variantType: 'cor',
    skus: ['PU001', 'PU003', 'PU004'],
  },
  {
    groupId: 'G76',
    displayName: 'RESINA INCOLOR',
    variantType: 'peso',
    skus: ['RE001', 'RE002'],
  },
  {
    groupId: 'G77',
    displayName: 'RESINA POLIÉSTER',
    variantType: 'peso',
    skus: ['RE003', 'RE004'],
  },
  {
    groupId: 'G78',
    displayName: 'SILICONE TYTAN',
    variantType: 'cor/peso',
    skus: ['SL001', 'SL002'],
  },

  // --------------------------------------------------
  // SUPORTES DE LIXA
  // --------------------------------------------------
  {
    groupId: 'G79',
    displayName: 'REFIL DE VELCRO',
    variantType: 'diâmetro',
    skus: ['RF001', 'RF002'],
  },
  {
    groupId: 'G80',
    displayName: 'SUPORTE DE LIXA C/ VELCRO 100MM',
    variantType: 'material/rigidez',
    skus: ['SP001', 'SP002', 'SP003', 'SP004'],
  },
  {
    groupId: 'G81',
    displayName: 'SUPORTE DE LIXA C/ VELCRO 180MM',
    variantType: 'material/rigidez',
    skus: ['SP005', 'SP006', 'SP007'],
  },
  {
    groupId: 'G82',
    displayName: 'SUPORTE DE LIXA S/ VELCRO 180MM',
    variantType: 'rigidez',
    skus: ['SP008', 'SP009'],
  },

  // --------------------------------------------------
  // HIDRÁULICA
  // --------------------------------------------------
  {
    groupId: 'G83',
    displayName: 'REGISTRO ESPERA',
    variantType: 'bitola',
    skus: ['RG001', 'RG002'],
  },

  // --------------------------------------------------
  // SERRA COPO
  // --------------------------------------------------
  {
    groupId: 'G84',
    displayName: 'SERRA COPO',
    variantType: 'diâmetro/modelo',
    skus: [
      'SR005', 'SR006', 'SR007', 'SR008', 'SR009', 'SR010',
      'SR011', 'SR012', 'SR013', 'SR014', 'SR015', 'SR016',
    ],
  },
];

/**
 * Itens individuais que permanecem como produtos simples (não formam grupos artificiais):
 * - CU012: CUBA INDUSTRIAL 50X40X25 AÇO 304
 * - CU013: CUBA OVAL DE LOUÇA 39X30 ONIX
 * - RB008: REBOLO CONICO MINI #120
 */
export const EXPLICIT_SINGLE_CANDIDATE_SKUS: string[] = ['CU012', 'CU013', 'RB008'];
