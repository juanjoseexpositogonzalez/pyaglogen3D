function fig_hdl = salida_english_build
% SALIDA_BUILD
%-------------------------------------------------------------------------------
% File name   : salida_english_build.m
%-------------------------------------------------------------------------------
 
 
% Initialize handles structure
handles = struct();
 
% Create all UI controls
build_gui();
 
% Assign function output
fig_hdl = handles.figura_salida;
 
 
    %% ---------------------------------------------------------------------------
 
% Variables
    handles.granulado=getappdata(0,'Granulado');
    handles.numero_fila_grafico=2;
    handles.nombre_archivo='';
    handles.n_veces_nuevo_aplast=1; setappdata(0,'n_veces_nuevo_aplast',handles.n_veces_nuevo_aplast);
    handles.n_veces_nueva_img=1; setappdata(0,'n_veces_nueva_img',handles.n_veces_nueva_img);
    
    handles.aplicacion=getappdata(0,'Aplicacion');
    if strcmp(handles.aplicacion,'MCIA')
    handles.tipo_mot=getappdata(0,'tipo_mot');
    handles.S=getappdata(0,'S');
    handles.D=getappdata(0,'D');
    handles.p_mot=getappdata(0,'p_mot');
    handles.n=getappdata(0,'n');
    handles.M=getappdata(0,'M');
    handles.egr=getappdata(0,'egr');
    handles.T_amb=getappdata(0,'T_amb');
    handles.p_amb=getappdata(0,'p_amb');
    handles.w_r=getappdata(0,'w_r');
    handles.tipo_comb=getappdata(0,'tipo_comb');
    handles.empresa_comb=getappdata(0,'empresa_comb');
    end
    
    if strcmp(handles.aplicacion,'Quemador')
    handles.tipo_quemador=getappdata(0,'tipo_quemador');
    handles.altura=getappdata(0,'altura');
    handles.diametro=getappdata(0,'diametro');
    handles.oxidante=getappdata(0,'oxidante');
    handles.dosado=getappdata(0,'dosado');
    handles.caudal=getappdata(0,'caudal');
    handles.T_amb=getappdata(0,'T_amb');
    handles.p_amb=getappdata(0,'p_amb');
    handles.w_r=getappdata(0,'w_r');
    handles.tipo_comb=getappdata(0,'tipo_comb');
    handles.empresa_comb=getappdata(0,'empresa_comb');
    end
    
    if strcmp(handles.aplicacion,'Caldera')
    handles.tipo_caldera=getappdata(0,'tipo_caldera');
    handles.altura=getappdata(0,'altura');
    handles.diametro=getappdata(0,'diametro');
    handles.dosado=getappdata(0,'dosado');
    handles.egr=getappdata(0,'egr');
    handles.caudal=getappdata(0,'caudal');
    handles.T_amb=getappdata(0,'T_amb');
    handles.p_amb=getappdata(0,'p_amb');
    handles.w_r=getappdata(0,'w_r');
    handles.tipo_comb=getappdata(0,'tipo_comb');
    handles.empresa_comb=getappdata(0,'empresa_comb');
    end
    
    if strcmp(handles.aplicacion,'Turbina')
    handles.tipo_turbina=getappdata(0,'tipo_turbina');
    handles.p_alta=getappdata(0,'p_alta');
    handles.p_baja=getappdata(0,'p_baja');
    handles.caudal=getappdata(0,'caudal');
    handles.potencia=getappdata(0,'potencia');
    handles.egr=getappdata(0,'egr');
    handles.T_amb=getappdata(0,'T_amb');
    handles.p_amb=getappdata(0,'p_amb');
    handles.w_r=getappdata(0,'w_r');
    handles.tipo_comb=getappdata(0,'tipo_comb');
    handles.empresa_comb=getappdata(0,'empresa_comb');
    end
    
    if strcmp(handles.aplicacion,'Otro')
    handles.otro_estudio=getappdata(0,'otro_estudio');
    end
    
    handles.grupo=getappdata(0,'grupo');
    handles.version=getappdata(0,'version');
    handles.estudio=getappdata(0,'estudio');
    
    handles.dfmat=getappdata(0,'dfmat');
    
        %Recordatorio, orden de dfmat:
        %dfmat(contdimfrac,1)=foto(ipri);
        %dfmat(contdimfrac,2)=jpri;
        %dfmat(contdimfrac,3)=Rg;
        %dfmat(contdimfrac,4)=Ap;
        %dfmat(contdimfrac,5)=npo;
        %dfmat(contdimfrac,6)=Df;
        %dfmat(contdimfrac,7)=kf;
        %dfmat(contdimfrac,8)=zf; %NUEVA SALIDA
        %dfmat(contdimfrac,9)=Jf; %NUEVA SALIDA 
        %dfmat(contdimfrac,10)=vol; %NUEVA SALIDA 
        %dfmat(contdimfrac,11)=masa; %NUEVA SALIDA
        %dfmat(contdimfrac,12)=Asup; %NUEVA SALIDA
        %dfmat{contdimfrac,13}=delta; %No existe en 1
        %dfmat{contdimfrac,14}=fallo; %En 1 es la columna 13
 
if size(handles.dfmat{1},1)>=2 || handles.estudio==1
    set(handles.eje_y_panel,'visible','on');
    set(handles.eje_x_panel,'visible','on');
    set(handles.ver_graf_boton,'visible','on');
    set(handles.exportar_graf_boton,'visible','on');
else
    set(handles.media_imprimir_check,'enable','off');
    set(handles.desv_tip_imprimir_check,'enable','off');
end
 
if handles.estudio==1
    set(handles.aplast_x_texto,'visible','on','value',1);
    set(handles.media_imprimir_check,'enable','off');
    set(handles.desv_tip_imprimir_check,'enable','off');
    set(handles.nueva_img_boton,'visible','on');
elseif handles.estudio==0 && size(handles.dfmat{1},1)>=2
    set(handles.Rg_x_check,'visible','on');
    set(handles.Ap_x_check,'visible','on');
    set(handles.Df_x_check,'visible','on');
    set(handles.npo_x_check,'visible','on');
    set(handles.k_x_check,'visible','on');
    set(handles.J_x_check,'visible','on');
    set(handles.volumen_x_check,'visible','on');
    set(handles.masa_x_check,'visible','on');
    set(handles.Asup_x_check,'visible','on');
end
    
if strcmp(handles.version{1},'2')==1 && handles.estudio==0
    set(handles.nuevo_aplast_boton,'visible','on');
end

if strcmp(handles.granulado,'No')
    set(handles.nuevo_aplast_boton,'visible','off');
end
 
%% ---------------------------------------------------------------------------
    function build_gui()
% Creation of all uicontrols
 
        %  --- FIGURE -------------------------------------
        handles.figura_salida = figure( ...
            'Tag', 'figura_salida', ...
            'Units', 'characters', ...
            'Position', [81.2 6.23076923076923 231.6 55], ...
            'Name', 'Output_data', ...
            'MenuBar', 'none', ...
            'NumberTitle', 'off', ...
            'Color', [0.4 0.6 1]);
 
        % --- PANELS -------------------------------------
        handles.eje_y_panel = uibuttongroup( ...
            'Parent', handles.figura_salida, ...
            'Tag', 'eje_y_panel', ...
            'Units', 'characters', ...
            'Position', [9.8 41.5 105 10.6153846153846], ...
            'Title', 'y axis', ...
            'TitlePosition', 'centertop', ...
            'visible', 'off', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [0.4 0.3 1], ...
            'HighlightColor', [1 0.35 0], ...
            'TitlePosition', 'Centertop');
            
        handles.eje_x_panel = uibuttongroup( ...
            'Parent', handles.figura_salida, ...
            'Tag', 'eje_x_panel', ...
            'Units', 'characters', ...
            'Position', [120 41.5 105 10.6153846153846], ...
            'Title', 'x axis', ...
            'TitlePosition', 'centertop', ...
            'visible', 'off', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [0.4 0.3 1], ...
            'HighlightColor', [1 0.35 0], ...
            'TitlePosition', 'Centertop');
             
        handles.tabla_panel = uipanel( ...
            'Parent', handles.figura_salida, ...
            'Tag', 'tabla_panel', ...
            'Units', 'characters', ...
            'Position', [9.8 2 43 38], ...
            'Title', 'Save data table in Excel', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [0.4 0.3 1], ...
            'HighlightColor', [1 0.35 0], ...
            'TitlePosition', 'Centertop');
 
        % --- TABLES -------------------------------------
        handles.tabla = uitable( ...
            'Parent', handles.figura_salida, ...
            'Tag', 'tabla', ...
            'Units', 'characters', ...
            'visible', 'off', ...
            'Position', [56 5.0769230769231 172 29.7]);
        
        % --- AXES -------------------------------------
        handles.axes1 = axes( ...
            'Parent', handles.figura_salida, ...
            'Tag', 'axes1', ...
            'Units', 'characters', ...
            'visible', 'off', ...
            'Position', [88.4 8 104.8 27]);
 
        % --- STATIC TEXTS -------------------------------------
        handles.salida_datos_texto = uicontrol( ...
            'Parent', handles.figura_salida, ...
            'Tag', 'salida_datos_texto', ...
            'Style', 'text', ...
            'Units', 'characters', ...
            'Position', [100 52.5 31.6 1.5], ...
            'FontSize', 15, ...
            'FontName', 'Candara', ...
            'Backgroundcolor', [0.4 0.6 1], ...
            'Foregroundcolor', [1 1 1],...
            'String', 'OUTPUT DATA');
 
        % --- PUSHBUTTONS -------------------------------------
        
        handles.nueva_entrada_boton = uicontrol( ...
            'Parent', handles.figura_salida, ...
            'Tag', 'nueva_entrada_boton', ...
            'Style', 'pushbutton', ...
            'Units', 'characters', ...
            'Position', [114.2 1.61538461538462 22.4 2.38461538461538], ...
            'String', 'New input', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [0.4 0.3 1], ...
            'Callback', @nueva_entrada_boton_Callback);
        
        handles.nueva_img_boton = uicontrol( ...
            'Parent', handles.figura_salida, ...
            'Tag', 'nueva_img_boton', ...
            'Style', 'pushbutton', ...
            'Units', 'characters', ...
            'Position', [138.6 1.61538461538462 30.4 2.38461538461538], ...
            'String', 'Add image to study', ...
            'visible', 'off', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [0.4 0.3 1], ...
            'Callback', @nueva_img_boton_Callback);
        
        handles.nuevo_aplast_boton = uicontrol( ...
            'Parent', handles.figura_salida, ...
            'Tag', 'nuevo_aplast_boton', ...
            'Style', 'pushbutton', ...
            'Units', 'characters', ...
            'Position', [171 1.61538461538462 22.4 2.38461538461538], ...
            'String', 'New sintering', ...
            'visible', 'off', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [0.4 0.3 1], ...
            'Callback', @nuevo_aplast_boton_Callback);
        
        handles.salir_boton = uicontrol( ...
            'Parent', handles.figura_salida, ...
            'Tag', 'salir_boton', ...
            'Style', 'pushbutton', ...
            'Units', 'characters', ...
            'Position', [195.4 1.61538461538462 22.4 2.38461538461538], ...
            'String', 'Exit', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [0.4 0.3 1], ...
            'Callback', @salir_boton_Callback);
 
        handles.ver_tabla_boton = uicontrol( ...
            'Parent', handles.tabla_panel, ...
            'Tag', 'ver_tabla_boton', ...
            'Style', 'pushbutton', ...
            'Units', 'characters', ...
            'Position', [3 4.2 35 1.76923076923077], ...
            'String', 'Show table', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [0.4 0.3 1], ...
            'Callback', @ver_tabla_boton_Callback);
        
        handles.exportar_tabla_boton = uicontrol( ...
            'Parent', handles.tabla_panel, ...
            'Tag', 'exportar_tabla_boton', ...
            'Style', 'pushbutton', ...
            'Units', 'characters', ...
            'Position', [3 2 35 1.76923076923077], ...
            'String', 'Save table', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [0.4 0.3 1], ...
            'Callback', @exportar_tabla_boton_Callback);
 
        handles.ver_graf_boton = uicontrol( ...
            'Parent', handles.figura_salida, ...
            'Tag', 'ver_graf_boton', ...
            'Style', 'pushbutton', ...
            'Units', 'characters', ...
            'Position', [193.8 39 28 2], ...
            'String', 'Show graphic', ...
            'visible', 'off', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [0.4 0.3 1], ...
            'Callback', @ver_graf_boton_Callback);
        
        handles.exportar_graf_boton = uicontrol( ...
            'Parent', handles.figura_salida, ...
            'Tag', 'exportar_graf_boton', ...
            'Style', 'pushbutton', ...
            'Units', 'characters', ...
            'Position', [193.8 36.61538462 28 2], ...
            'String', 'Save graphic', ...
            'visible', 'off', ...
            'enable', 'on', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [0.4 0.3 1], ...
            'Callback', @exportar_graf_boton_Callback);
 
        % --- RADIOBUTTONS -------------------------------------
        
        handles.Rg_x_check = uicontrol( ...
            'Parent', handles.eje_x_panel, ...
            'Tag', 'Rg_x_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [2.4 6.69230769230771 30 1.76923076923077], ...
            'visible', 'off', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Radius of gyration');
 
        handles.Ap_x_check = uicontrol( ...
            'Parent', handles.eje_x_panel, ...
            'Tag', 'Ap_x_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [2.4 4.00000000000001 30 1.76923076923077], ...
            'visible', 'off', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Projected area');
 
        handles.npo_x_check = uicontrol( ...
            'Parent', handles.eje_x_panel, ...
            'Tag', 'npo_x_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [33 6.69230769230771 35 1.76923076923077], ...
            'visible', 'off', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'n. primary particles');
 
        handles.Df_x_check = uicontrol( ...
            'Parent', handles.eje_x_panel, ...
            'Tag', 'Df_x_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [2.4 1.30769230769232 30 1.76923076923077], ...
            'visible', 'off', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Fractal dimension');
 
        handles.k_x_check = uicontrol( ...
            'Parent', handles.eje_x_panel, ...
            'Tag', 'k_x_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [33 4.00000000000001 30 1.76923076923077], ...
            'visible', 'off', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Prefactor');
        
        handles.J_x_check = uicontrol( ...
            'Parent', handles.eje_x_panel, ...
            'Tag', 'J_x_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [33 1.30769230769232 35 1.76923076923077], ...
            'visible', 'off', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Coordination number');
        
        handles.volumen_x_check = uicontrol( ...
            'Parent', handles.eje_x_panel, ...
            'Tag', 'volumen_x_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [68.5 6.69230769230771 35 1.76923076923077], ...
            'visible', 'off', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Agglomerate volume');
        
        handles.masa_x_check = uicontrol( ...
            'Parent', handles.eje_x_panel, ...
            'Tag', 'masa_x_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [68.5 4.00000000000001 35 1.76923076923077], ...
            'visible', 'off', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Agglomerate mass');
        
        handles.Asup_x_check = uicontrol( ...
            'Parent', handles.eje_x_panel, ...
            'Tag', 'Asup_x_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [68.5 1.30769230769232 35 1.76923076923077], ...
            'visible', 'off', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Agglomerate sur. area');
 
        handles.aplast_x_texto = uicontrol( ...
            'Parent', handles.eje_x_panel, ...
            'Tag', 'aplast_x_texto', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [38 3.5 40 3.5], ...
            'visible', 'off', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', '<html>Sintering coefficient &#948;</html>');
        
        handles.Rg_y_check = uicontrol( ...
            'Parent', handles.eje_y_panel, ...
            'Tag', 'Rg_y_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [2.4 6.69230769230771 30 1.76923076923077], ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Radius of gyration');
        
        handles.k_y_check = uicontrol( ...
            'Parent', handles.eje_y_panel, ...
            'Tag', 'k_y_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [33 4.00000000000001 30 1.76923076923077], ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Prefactor');
 
        handles.Df_y_check = uicontrol( ...
            'Parent', handles.eje_y_panel, ...
            'Tag', 'Df_y_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [2.4 1.30769230769232 30 1.76923076923077], ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Fractal dimension');
 
        handles.npo_y_check = uicontrol( ...
            'Parent', handles.eje_y_panel, ...
            'Tag', 'npo_y_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [33 6.69230769230771 35 1.76923076923077], ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'n. primary particles');
 
        handles.Ap_y_check = uicontrol( ...
            'Parent', handles.eje_y_panel, ...
            'Tag', 'Ap_y_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [2.4 4.00000000000001 30 1.76923076923077], ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Projected area');
        
        handles.J_y_check = uicontrol( ...
            'Parent', handles.eje_y_panel, ...
            'Tag', 'J_y_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [33 1.30769230769232 35 1.76923076923077], ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Coordination number');
        
        handles.volumen_y_check = uicontrol( ...
            'Parent', handles.eje_y_panel, ...
            'Tag', 'volumen_y_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [68.5 6.69230769230771 35 1.76923076923077], ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Agglomerate volume');
        
        handles.masa_y_check = uicontrol( ...
            'Parent', handles.eje_y_panel, ...
            'Tag', 'masa_y_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [68.5 4.00000000000001 35 1.76923076923077], ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Agglomerate mass');
        
        handles.Asup_y_check = uicontrol( ...
            'Parent', handles.eje_y_panel, ...
            'Tag', 'Asup_y_check', ...
            'Style', 'radiobutton', ...
            'Units', 'characters', ...
            'Position', [68.5 1.30769230769232 35 1.76923076923077], ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'String', 'Agglomerate sur. area');
 
        % --- CHECKBOXES -------------------------------------
              
        handles.Rg_imprimir_check = uicontrol( ...
            'Parent', handles.tabla_panel, ...
            'Tag', 'Rg_imprimir_check', ...
            'Style', 'checkbox', ...
            'Units', 'characters', ...
            'Position', [3 34 35 1.76923076923077], ...
            'String', 'Radius of gyration', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'value', 1);
        
        handles.Ap_imprimir_check = uicontrol( ...
            'Parent', handles.tabla_panel, ...
            'Tag', 'Ap_imprimir_check', ...
            'Style', 'checkbox', ...
            'Units', 'characters', ...
            'Position', [3 31.6 35 1.76923076923077], ...
            'String', 'Projected area', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'value', 1);
        
        handles.npo_imprimir_check = uicontrol( ...
            'Parent', handles.tabla_panel, ...
            'Tag', 'npo_imprimir_check', ...
            'Style', 'checkbox', ...
            'Units', 'characters', ...
            'Position', [3 29.2 35 1.76923076923077], ...
            'String', 'n. primary particles', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ... 
            'Foregroundcolor', [1 0.35 0],...
            'value', 1);
 
        handles.Df_imprimir_check = uicontrol( ...
            'Parent', handles.tabla_panel, ...
            'Tag', 'Df_imprimir_check', ...
            'Style', 'checkbox', ...
            'Units', 'characters', ... 
            'Position', [3 26.8 35 1.76923076923077], ...
            'String', 'Fractal dimension', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'value', 1);
 
        handles.k_imprimir_check = uicontrol( ...
            'Parent', handles.tabla_panel, ...
            'Tag', 'k_imprimir_check', ...
            'Style', 'checkbox', ...
            'Units', 'characters', ... 
            'Position', [3 24.4 35 1.76923076923077], ...
            'String', 'Prefactor', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'value', 1);
        
        handles.z_imprimir_check = uicontrol( ...
            'Parent', handles.tabla_panel, ...
            'Tag', 'z_imprimir_check', ...
            'Style', 'checkbox', ...
            'Units', 'characters', ...
            'Position', [3 22 35 1.76923076923077], ...
            'String', 'Overlap exponent', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'value', 1);
        
        handles.J_imprimir_check = uicontrol( ...
            'Parent', handles.tabla_panel, ...
            'Tag', 'J_imprimir_check', ...
            'Style', 'checkbox', ...
            'Units', 'characters', ... 
            'Position', [3 19.6 35 1.76923076923077], ...
            'String', 'Coordination number', ... 
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'value', 1);
 
        handles.volumen_imprimir_check = uicontrol( ...
            'Parent', handles.tabla_panel, ...
            'Tag', 'volumen_imprimir_check', ...
            'Style', 'checkbox', ...
            'Units', 'characters', ... 
            'Position', [3 17.2 35 1.76923076923077], ...
            'String', 'Agglomerate volume', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'value', 1);
        
        handles.masa_imprimir_check = uicontrol( ...
            'Parent', handles.tabla_panel, ...
            'Tag', 'masa_imprimir_check', ...
            'Style', 'checkbox', ...
            'Units', 'characters', ... 
            'Position', [3 14.8 35 1.76923076923077], ...
            'String', 'Agglomerate mass', ... 
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'value', 1);
        
        handles.Asup_imprimir_check = uicontrol( ...
            'Parent', handles.tabla_panel, ...
            'Tag', 'Asup_imprimir_check', ...
            'Style', 'checkbox', ...
            'Units', 'characters', ... 
            'Position', [3 12.4 35 1.76923076923077], ...
            'String', 'Agglomerate sur. area', ... 
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0],...
            'value', 1);
 
        handles.media_imprimir_check = uicontrol( ...
            'Parent', handles.tabla_panel, ...
            'Tag', 'media_imprimir_check', ...
            'Style', 'checkbox', ...
            'Units', 'characters', ...
            'Position', [3 10 35 1.76923076923077], ...
            'String', 'Data average', ... 
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0]);
 
        handles.desv_tip_imprimir_check = uicontrol( ...
            'Parent', handles.tabla_panel, ...
            'Tag', 'desv_tip_imprimir_check', ...
            'Style', 'checkbox', ...
            'Units', 'characters', ...
            'Position', [3 7.6 35 1.76923076923077], ...
            'String', 'Standard deviation', ...
            'FontSize', 12, ...
            'FontName', 'Candara', ...
            'Foregroundcolor', [1 0.35 0]);
 
        movegui(handles.figura_salida,'center')
    end
    
%% ---------------------------------------------------------------------------
    function nueva_entrada_boton_Callback(hObject,evendata) %#ok<INUSD>
        app=getappdata(0); %get all the appdata of 0
        %and then
        appdatas = fieldnames(app);
        for kA = 1:length(appdatas)
            rmappdata(0,appdatas{kA});
        end
        close;
        Tipo_fractal_english_build;
    end
 
%% ---------------------------------------------------------------------------
    function nueva_img_boton_Callback(hObject,evendata) %#ok<INUSD>
        
        handles.n_veces_nueva_img=getappdata(0,'n_veces_nueva_img');
        
        if handles.n_veces_nueva_img>=5
            msg=msgbox('El número total máximo de imágenes estudiadas es de 5','Información');
                kids0=findobj(msg,'Type','UIControl');
                kids1=findobj(msg,'Type','Text');
 
                % change the font and fontsize
                extent0=get(kids1,'Extent'); % text extent in old font
                set([kids0,kids1],'FontName','Candara','FontSize',12);
                set(kids0,'Foregroundcolor',[0.4 0.3 1]);
                extent1=get(kids1,'Extent'); % text extent in new font
 
                % need to resize the msgbox object to accommodate new FontName
                % and FontSize
                dlgdelta=extent1-extent0; % change in extent
            
                pos=get(kids0,'Position'); % msgbox current position
                pos=pos+dlgdelta; % change size of msgbox
                set(kids0,'Position',pos); % set new position
            
                pos=get(msg,'Position'); % msgbox current position
                pos=pos+dlgdelta; % change size of msgbox
                set(msg,'Position',pos); % set new position
        else
            nueva_img_boton_english_build;
        end
        
    end
 
%% ---------------------------------------------------------------------------
    function salir_boton_Callback(hObject,evendata) %#ok<INUSD>
        app=getappdata(0); %get all the appdata of 0
        %and then
        appdatas = fieldnames(app);
        for kA = 1:length(appdatas)
            rmappdata(0,appdatas{kA});
        end
        close all;
    end
 
%% ---------------------------------------------------------------------------
    function nuevo_aplast_boton_Callback(hObject,evendata) %#ok<INUSD> 
        
        handles.dfmat=getappdata(0,'dfmat');
        handles.n_veces_nuevo_aplast=getappdata(0,'n_veces_nuevo_aplast');
        
        if handles.n_veces_nuevo_aplast>=5
            msg=msgbox('El límite máximo de ejecuciones con un coeficiente de aplastamiento nuevo es de 5.','Información');
                kids0=findobj(msg,'Type','UIControl');
                kids1=findobj(msg,'Type','Text');
 
                % change the font and fontsize
                extent0=get(kids1,'Extent'); % text extent in old font
                set([kids0,kids1],'FontName','Candara','FontSize',12);
                set(kids0,'Foregroundcolor',[0.4 0.3 1]);
                extent1=get(kids1,'Extent'); % text extent in new font
 
                % need to resize the msgbox object to accommodate new FontName
                % and FontSize
                dlgdelta=extent1-extent0; % change in extent
            
                pos=get(kids0,'Position'); % msgbox current position
                pos=pos+dlgdelta; % change size of msgbox
                set(kids0,'Position',pos); % set new position
            
                pos=get(msg,'Position'); % msgbox current position
                pos=pos+dlgdelta; % change size of msgbox
                set(msg,'Position',pos); % set new position
        else
        
            % --- FIGURE -------------------------------------
                handles.figura_aplast = figure( ...
                    'Tag', 'figura_aplast', ...
                    'Units', 'characters', ...
                    'Position', [58 8.5 46 8], ...
                    'Name', 'New_sintering', ...
                    'MenuBar', 'none', ...
                    'NumberTitle', 'off', ...
                    'Color', get(0,'DefaultUicontrolBackgroundColor'));
 
            % --- STATIC TEXTS -------------------------------------
                handles.nueva_delta = uicontrol( ...
                    'Parent', handles.figura_aplast, ...
                    'Tag', 'nueva_delta', ...
                    'Style', 'text', ...
                    'Units', 'characters', ...
                    'Position', [6 3.6 20 2], ...
                    'FontSize', 12, ...
                    'FontName', 'Candara', ...
                    'Foregroundcolor', [1 0.35 0],...
                    'String', 'Sint. coeff.=');
        
            % --- EDIT TEXTS -------------------------------------
                handles.nueva_delta_entrada = uicontrol( ...
                    'Parent', handles.figura_aplast, ...
                    'Tag', 'delta_v_2_entrada', ...
                    'Style', 'edit', ...
                    'Units', 'characters', ...
                    'Position', [26 4 10.5 2], ...
                    'BackgroundColor', [1 1 1], ...
                    'FontSize', 12, ...
                    'FontName', 'Candara', ...
                    'String', num2str(handles.dfmat{size(handles.dfmat,1)}{1,13}));%Cambio
        
            % --- PUSHBUTTONS -------------------------------------
                handles.tomar_aplast_boton = uicontrol( ...
                    'Parent', handles.figura_aplast, ...
                    'Tag', 'tomar_aplast_boton', ...
                    'Style', 'pushbutton', ...
                    'Units', 'characters', ...
                    'Position', [13 1.4 20 2.07692307692308], ...
                    'String', 'OK', ...
                    'FontSize', 12, ...
                    'FontName', 'Candara', ...
                    'Foregroundcolor', [0.4 0.6 1], ...
                    'Callback', {@tomar_aplast_boton_Callback,handles});
    
            movegui(handles.figura_aplast,'center')
        
        end
    end
 
%% ---------------------------------------------------------------------------
    function ver_tabla_boton_Callback(hObject,evendata) %#ok<INUSD>
        handles.version=getappdata(0,'version');
        handles.dfmat=getappdata(0,'dfmat');
 
        handles.salida=[]; handles.matriz=[];
        for i=1:size(handles.version,1)
            [salida,matriz]=fnc_salida(handles.dfmat{i}, ...
                                            get(handles.Rg_imprimir_check,'value'), ...
                                            get(handles.Ap_imprimir_check,'value'), ...
                                            get(handles.npo_imprimir_check,'value'), ...
                                            get(handles.Df_imprimir_check,'value'), ...
                                            get(handles.k_imprimir_check,'value'), ...
                                            get(handles.z_imprimir_check,'value'), ... %NUEVO CAMBIO
                                            get(handles.J_imprimir_check,'value'), ... %NUEVO CAMBIO
                                            get(handles.volumen_imprimir_check,'value'), ... %NUEVO CAMBIO
                                            get(handles.masa_imprimir_check,'value'), ... %NUEVO CAMBIO
                                            get(handles.Asup_imprimir_check,'value'), ... %NUEVO CAMBIO
                                            get(handles.media_imprimir_check,'value'), ...
                                            get(handles.desv_tip_imprimir_check,'value'), ...
                                            handles.version{i}, ...
                                            handles.grupo, ...
                                            handles.estudio);
            handles.salida=[handles.salida;salida];
            handles.matriz=[handles.matriz;matriz];
        end
        set(handles.axes1,'visible','off');
        set(handles.tabla,'Data',handles.salida);
        set(handles.tabla,'visible', 'on');
    end
        
%% ---------------------------------------------------------------------------
    function exportar_tabla_boton_Callback(hObject,evendata) %#ok<INUSD>
        handles.version=getappdata(0,'version');
        handles.dfmat=getappdata(0,'dfmat');
        
        if exist('salida_analisis_fractal.xlsx', 'file')==0
            archivo_nuevo=strcat('salida_analisis_fractal.xlsx');
        else
            jpri=2;
            archivo_nuevo=strcat('salida_analisis_fractal','-',int2str(jpri),'.xlsx');
            while (exist(archivo_nuevo, 'file')==2)
                jpri=jpri+1;
                archivo_nuevo=strcat('salida_analisis_fractal','-',int2str(jpri),'.xlsx');
            end
        end
        
        handles.salida=[]; handles.matriz=[];
        for i=1:size(handles.dfmat,1)            
            [salida,matriz]=fnc_salida(handles.dfmat{i}, ...
                                            get(handles.Rg_imprimir_check,'value'), ...
                                            get(handles.Ap_imprimir_check,'value'), ...
                                            get(handles.npo_imprimir_check,'value'), ...
                                            get(handles.Df_imprimir_check,'value'), ...
                                            get(handles.k_imprimir_check,'value'), ...
                                            get(handles.z_imprimir_check,'value'), ... %NUEVO CAMBIO
                                            get(handles.J_imprimir_check,'value'), ... %NUEVO CAMBIO
                                            get(handles.volumen_imprimir_check,'value'), ... %NUEVO CAMBIO
                                            get(handles.masa_imprimir_check,'value'), ... %NUEVO CAMBIO
                                            get(handles.Asup_imprimir_check,'value'), ... %NUEVO CAMBIO
                                            get(handles.media_imprimir_check,'value'), ...
                                            get(handles.desv_tip_imprimir_check,'value'), ...
                                            handles.version{i}, ...
                                            handles.grupo, ...
                                            handles.estudio);
            handles.salida=[handles.salida;salida];
            handles.matriz=[handles.matriz;matriz];
        end
        
        handles.aplicacion=getappdata(0,'Aplicacion');
        
        if strcmp(handles.aplicacion,'MCIA')
        xlswrite(archivo_nuevo,{strcat(['MCIA tipo ',handles.tipo_mot,', S=',handles.S,' mm, D=',handles.D,' mm, p=',handles.p_mot,' bar'])},1,'A1');
        xlswrite(archivo_nuevo,{strcat(['Condiciones de funcionamiento: n=',handles.n,' rpm, M=',handles.M,' Nm, EGR=',handles.egr,' %'])},1,'A2');
        xlswrite(archivo_nuevo,{strcat(['Condiciones ambientales: T=',handles.T_amb,' ºC, p=', handles.p_amb,' bar, w_r=',handles.w_r,' %'])},1,'A3');
        xlswrite(archivo_nuevo,{strcat(['Combustible: ',handles.tipo_comb,', Empresa: ', handles.empresa_comb])},1,'A4');
        xlswrite(archivo_nuevo,handles.salida,1,'A6');
        end
        
        if strcmp(handles.aplicacion,'Quemador')
        xlswrite(archivo_nuevo,{strcat(['Quemador tipo ',handles.tipo_quemador,', Altura de llama=',handles.altura,' mm, Diámetro de llama=',handles.diametro,' mm'])},1,'A1');
        xlswrite(archivo_nuevo,{strcat(['Condiciones de funcionamiento: Oxidante=',handles.oxidante,' , Dosado=',handles.dosado,' , Caudal de oxidante=',handles.caudal,' m3/s'])},1,'A2');
        xlswrite(archivo_nuevo,{strcat(['Condiciones ambientales: T=',handles.T_amb,' ºC, p=', handles.p_amb,' bar, w_r=',handles.w_r,' %'])},1,'A3');
        xlswrite(archivo_nuevo,{strcat(['Combustible: ',handles.tipo_comb,', Empresa: ', handles.empresa_comb])},1,'A4');
        xlswrite(archivo_nuevo,handles.salida,1,'A6');
        end
        
        if strcmp(handles.aplicacion,'Caldera')
        xlswrite(archivo_nuevo,{strcat(['Caldera tipo ',handles.tipo_caldera,', Altura de llama=',handles.altura,' mm, Diámetro de llama=',handles.diametro,' mm'])},1,'A1');
        xlswrite(archivo_nuevo,{strcat(['Condiciones de funcionamiento: Dosado=',handles.dosado,' , Caudal de aire=',handles.caudal,' m3/s, EGR=',handles.egr,' %'])},1,'A2');
        xlswrite(archivo_nuevo,{strcat(['Condiciones ambientales: T=',handles.T_amb,' ºC, p=', handles.p_amb,' bar, w_r=',handles.w_r,' %'])},1,'A3');
        xlswrite(archivo_nuevo,{strcat(['Combustible: ',handles.tipo_comb,', Empresa: ', handles.empresa_comb])},1,'A4');
        xlswrite(archivo_nuevo,handles.salida,1,'A6');
        end
        
        if strcmp(handles.aplicacion,'Turbina')
        xlswrite(archivo_nuevo,{strcat(['Turbina tipo ',handles.tipo_turbina,', Presión de alta=',handles.p_alta,' bar, Presión de baja=',handles.p_baja,' bar'])},1,'A1');
        xlswrite(archivo_nuevo,{strcat(['Condiciones de funcionamiento: Caudal de aire=',handles.caudal,' m3/s, Potencia=',handles.potencia,' MW, EGR=',handles.egr,' %'])},1,'A2');
        xlswrite(archivo_nuevo,{strcat(['Condiciones ambientales: T=',handles.T_amb,' ºC, p=', handles.p_amb,' bar, w_r=',handles.w_r,' %'])},1,'A3');
        xlswrite(archivo_nuevo,{strcat(['Combustible: ',handles.tipo_comb,', Empresa: ', handles.empresa_comb])},1,'A4');
        xlswrite(archivo_nuevo,handles.salida,1,'A6');
        end
        
        if strcmp(handles.aplicacion,'Otro')
        xlswrite(archivo_nuevo,{strcat(['Estudio: ', handles.otro_estudio])},1,'A4');
        xlswrite(archivo_nuevo,handles.salida,1,'A6');
        end
            
        setappdata(0,'nombre_archivo',archivo_nuevo);
        if exist(archivo_nuevo, 'file')
            msgbox(strcat('The table has been saved correctly in: ' ,archivo_nuevo),'Información');
        else
            msgbox(strcat('Error while saving file: ' ,archivo_nuevo),'Error');
        end
        
    end
 
%% ---------------------------------------------------------------------------
    function exportar_graf_boton_Callback(hObject,evendata) %#ok<INUSD>
 
        handles.nombre_archivo=getappdata(0,'nombre_archivo');
    
        if isempty(handles.nombre_archivo)==1
            mensaje=msgbox('Es necesario guardar primero los datos en un archivo excel. Pulse -Exportar tabla-','Información');
                kids0=findobj(mensaje,'Type','UIControl');
                kids1=findobj(mensaje,'Type','Text');
 
                % change the font and fontsize
                extent0=get(kids1,'Extent'); % text extent in old font
                set([kids0,kids1],'FontName','Candara','FontSize',12);
                set(kids0,'Foregroundcolor',[0.4 0.3 1]);
                extent1=get(kids1,'Extent'); % text extent in new font
 
                % need to resize the msgbox object to accommodate new FontName
                % and FontSize
                delta=extent1-extent0; % change in extent
            
                pos=get(kids0,'Position'); % msgbox current position
                pos=pos+delta; % change size of msgbox
                set(kids0,'Position',pos); % set new position
            
                pos=get(mensaje,'Position'); % msgbox current position
                pos=pos+delta; % change size of msgbox
                set(mensaje,'Position',pos); % set new position
                
        else
            aviso=warndlg('Si hubiese alguna ventana Excel abierta, por favor cerrarla.','Aviso');
                kids0=findobj(aviso,'Type','UIControl');
                kids1=findobj(aviso,'Type','Text');
 
                % change the font and fontsize
                extent0=get(kids1,'Extent'); % text extent in old font
                set([kids0,kids1],'FontName','Candara','FontSize',12);
                set(kids0,'Foregroundcolor',[0.4 0.3 1]);
                extent1=get(kids1,'Extent'); % text extent in new font
 
                % need to resize the msgbox object to accommodate new FontName
                % and FontSize
                delta=extent1-extent0; % change in extent
            
                pos=get(kids0,'Position'); % msgbox current position
                pos=pos+delta; % change size of msgbox
                set(kids0,'Position',pos); % set new position
            
                pos=get(aviso,'Position'); % msgbox current position
                pos=pos+delta; % change size of msgbox
                set(aviso,'Position',pos); % set new position
            
            uiwait(aviso);
            
            H=gca; f=figure('visible','off');
            copyobj(H,f);
            set(gca, 'position',[12 6 90.2 21.0769230769231]); 
            if handles.leyenda==1
                if strcmp(handles.version{1},'1')==1
                    legend('v.1','v.2','Location','Best');
                elseif strcmp(handles.version{1},'2')==1
                    legend(cellstr(handles.nombres_leyenda),'Location','Best');
                end
            end
            print -f -dmeta
 
            fileName=strcat(pwd,'\',handles.nombre_archivo); %fileName=handles.nombre_archivo;
            SheetName='Gráficos';
            SheetIndex=2;
            %Range='B2';
            Range =strcat('B',num2str(handles.numero_fila_grafico));
     
            Excel = actxserver ('Excel.Application');
 
            if ~exist(fileName,'file')
                ExcelWorkbook=Excel.Workbooks.Add;
                ExcelWorkbook.SaveAs(fileName);
                ExcelWorkbook.Close(false);
            end
            invoke(Excel.Workbooks,'Open',fileName); %Open the file
            Sheets = Excel.ActiveWorkBook.Sheets;
            if gt(SheetIndex,3)
                for i=1:SheetIndex-3
                    Excel.ActiveWorkBook.Sheets.Add;
                end 
            end 
            ActiveSheet = get(Sheets, 'Item', SheetIndex);
            set(ActiveSheet,'Name',SheetName)
            ActiveSheet.Select;
            ActivesheetRange = get(ActiveSheet,'Range',Range);
            ActivesheetRange.Select;
            ActivesheetRange.PasteSpecial; %.................Pasting the figure to the selected location
    
            ActiveSheet = get(Sheets, 'Item', 1);
            ActiveSheet.Select;
    
            Excel.ActiveWorkbook.Save% Now save the workbook
            if eq(Excel.ActiveWorkbook.Saved,1)
                Excel.ActiveWorkbook.Close;
            else
                Excel.ActiveWorkbook.Save;
            end
            invoke(Excel, 'Quit');   % Quit Excel    
            delete(Excel);% End process
            close gcf;
            
            handles.numero_fila_grafico= handles.numero_fila_grafico+22;
            mensaje=msgbox(strcat('The graphic has been saved correctly in: ' ,handles.nombre_archivo),'Información');
                    kids0=findobj(mensaje,'Type','UIControl');
                    kids1=findobj(mensaje,'Type','Text');
 
                    % change the font and fontsize
                    extent0=get(kids1,'Extent'); % text extent in old font
                    set([kids0,kids1],'FontName','Candara','FontSize',12);
                    set(kids0,'Foregroundcolor',[0.4 0.3 1]);
                    extent1=get(kids1,'Extent'); % text extent in new font
 
                    % need to resize the msgbox object to accommodate new FontName
                    % and FontSize
                    delta=extent1-extent0; % change in extent
            
                    pos=get(kids0,'Position'); % msgbox current position
                    pos=pos+delta; % change size of msgbox
                    set(kids0,'Position',pos); % set new position
            
                    pos=get(mensaje,'Position'); % msgbox current position
                    pos=pos+delta; % change size of msgbox
                    set(mensaje,'Position',pos); % set new position
        end
    end
 
%% ---------------------------------------------------------------------------
    function ver_graf_boton_Callback(hObject,evendata) %#ok<INUSD>
        handles.version=getappdata(0,'version');
        handles.dfmat=getappdata(0,'dfmat');
        
        handles.leyenda=0;
        set(handles.tabla,'visible','off');
        if handles.estudio==1
            i=1; colores={'blue','red',[0 0.5 0],[0.5 0 0.5],'magenta'};
            while i<=size(handles.dfmat,1)
                y=0;
                switch get(get(handles.eje_y_panel,'SelectedObject'),'Tag')
                    case 'Rg_y_check', p=plot (cell2mat(handles.dfmat{i}(:,13)),cell2mat(handles.dfmat{i}(:,3)),'-k'); xlabel('\delta'); ylabel('r_g [nm]'); 
                    case 'Ap_y_check', p=plot (cell2mat(handles.dfmat{i}(:,13)),cell2mat(handles.dfmat{i}(:,4)),'-k'); xlabel('\delta'); ylabel('A_p [nm^2]'); 
                    case 'npo_y_check'
                        fila=1;j=1;mat13=0;mat5=0;
                        while j<=size(handles.dfmat{i},1)
                            if handles.dfmat{i}{j,5}~=0
                                mat13(fila)=handles.dfmat{i}{j,13}; %antes 8
                                mat5(fila)=handles.dfmat{i}{j,5};
                                fila=fila+1;
                            end
                            j=j+1;
                        end
                        p=plot (mat13(:),mat5(:),'-k'); xlabel('\delta'); ylabel('n_p_o'); y=3; 
                    case 'Df_y_check'
                        fila=1;j=1;mat13=0;mat6=0;
                        while j<=size(handles.dfmat{i},1)
                            if handles.dfmat{i}{j,5}~=0
                                mat13(fila)=handles.dfmat{i}{j,13};
                                mat6(fila)=handles.dfmat{i}{j,6};
                                fila=fila+1;
                            end
                            j=j+1;
                        end
                        p=plot (mat13(:),mat6(:),'-k'); xlabel('\delta'); ylabel('D_f'); y=1;
                    case 'k_y_check'
                        fila=1;j=1;mat13=0;mat7=0;
                        while j<=size(handles.dfmat{i},1)
                            if handles.dfmat{i}{j,5}~=0
                                mat13(fila)=handles.dfmat{i}{j,13};
                                mat7(fila)=handles.dfmat{i}{j,7};
                                fila=fila+1;
                            end
                            j=j+1;
                        end
                        p=plot (mat13(:),mat7(:),'-k'); xlabel('\delta'); ylabel('k'); y=2;
                    case 'J_y_check'
                        fila=1;j=1;mat13=0;mat9=0;
                        while j<=size(handles.dfmat{i},1)
                            if handles.dfmat{i}{j,5}~=0
                                mat13(fila)=handles.dfmat{i}{j,13};
                                mat9(fila)=handles.dfmat{i}{j,9};
                                fila=fila+1;
                            end
                            j=j+1;
                        end
                        p=plot (mat13(:),mat9(:),'-k'); xlabel('\delta'); ylabel('J'); y=0;   
                    case 'volumen_y_check'
                        fila=1;j=1;mat13=0;mat10=0;
                        while j<=size(handles.dfmat{i},1)
                            if handles.dfmat{i}{j,5}~=0
                                mat13(fila)=handles.dfmat{i}{j,13};
                                mat10(fila)=handles.dfmat{i}{j,10};
                                fila=fila+1;
                            end
                            j=j+1;
                        end
                        p=plot (mat13(:),mat10(:),'-k'); xlabel('\delta'); ylabel('V_p [nm^3]'); y=0; 
                    case 'masa_y_check'
                        fila=1;j=1;mat13=0;mat11=0;
                        while j<=size(handles.dfmat{i},1)
                            if handles.dfmat{i}{j,5}~=0
                                mat13(fila)=handles.dfmat{i}{j,13};
                                mat11(fila)=handles.dfmat{i}{j,11};
                                fila=fila+1;
                            end
                            j=j+1;
                        end
                        p=plot (mat13(:),mat11(:),'-k'); xlabel('\delta'); ylabel('m_p [fg]'); y=0;  
                     case 'Asup_y_check'
                        fila=1;j=1;mat13=0;mat12=0;
                        while j<=size(handles.dfmat{i},1)
                            if handles.dfmat{i}{j,5}~=0
                                mat13(fila)=handles.dfmat{i}{j,13};
                                mat12(fila)=handles.dfmat{i}{j,12};
                                fila=fila+1;
                            end
                            j=j+1;
                        end
                        p=plot (mat13(:),mat12(:),'-k'); xlabel('\delta'); ylabel('A_p [nm^2]'); y=0;  
                end
                if y==1
                    ylim([1 3]) %axis([0.9 round((max(cell2mat(handles.dfmat{i}(:,13)))+0.05)*10)/10 1 3]); 
                elseif y==2
                    YL=ylim; ylim([min(YL(1),min_fnc(handles.dfmat{i})) max(YL(2),round((max(cell2mat(handles.dfmat{i}(:,7)))+0.1)*10)/10)]); %axis([0.9,round((max(cell2mat(handles.dfmat{i}(:,8)))+0.05)*10)/10,min_fnc(handles.dfmat{i}),round((max(cell2mat(handles.dfmat{i}(:,7)))+0.1)*10)/10]);
                elseif y==3
                    YL=ylim; ylim([min(YL(1),floor((min(cell2mat(handles.dfmat{i}(:,5)))-1)/10)*10) max(YL(2),floor((max(cell2mat(handles.dfmat{i}(:,5)))+1)/10)*10+10)]); %axis([0.9 round((max(cell2mat(handles.dfmat{i}(:,8)))+0.05)*10)/10 0 round(2*(min(cell2mat(handles.dfmat{i}(:,5))))/100)*100]);
                else
                    axis ('auto xy'); %axis([0.9 round((max(cell2mat(handles.dfmat{i}(:,8)))+0.05)*10)/10 1 3]); axis('auto y');
                end
                if size(handles.dfmat,1)~=1
                    set(p,'Color',colores{i}); 
                else
                    set(p,'Color','black');
                end
                hold on; handles.nombres_leyenda{i}=strcat(num2str(handles.dfmat{i}{1,1}));
                if size(handles.dfmat,1)==i
                    legend(cellstr(handles.nombres_leyenda),'Location','Best'); handles.leyenda=1; hold off;
                end
                i=i+1;
            end
        else
            if size(handles.version,1)==1
                [~,~,x,y]=fnc_plot(get(get(handles.eje_x_panel,'SelectedObject'),'Tag'),get(get(handles.eje_y_panel,'SelectedObject'),'Tag'),handles.dfmat{1});
                fnc_axis(x,y,handles.dfmat);
                if strcmp(handles.version,'2')==1
                    handles.nombres_leyenda=strcat('\delta=',num2str(handles.dfmat{1}{1,13})); legend(cellstr(handles.nombres_leyenda),'Location','Best'); handles.leyenda=1;
                end
  %          elseif get(handles.v_1_check,'value')==1 && get(handles.v_2_check,'value')==0 
   %             [~,~,x,y]=fnc_plot(get(get(handles.eje_x_panel,'SelectedObject'),'Tag'),get(get(handles.eje_y_panel,'SelectedObject'),'Tag'),handles.dfmat{1});
    %            fnc_axis(x,y,handles.dfmat);
   %         elseif get(handles.v_1_check,'value')==0 && get(handles.v_2_check,'value')==1 
    %            [~,~,x,y]=fnc_plot(get(get(handles.eje_x_panel,'SelectedObject'),'Tag'),get(get(handles.eje_y_panel,'SelectedObject'),'Tag'),handles.dfmat{2});
     %           fnc_axis(x,y,handles.dfmat);
     %       elseif get(handles.v_1_check,'value')==1 && get(handles.v_2_check,'value')==1
 %               if get(handles.npo_comp_check,'value')==1 
  %                  fila=1;i=1;
   %                 while i<=size(handles.dfmat{1},1)
    %                    if cell2mat(handles.dfmat{1}(i,5))~=0 && cell2mat(handles.dfmat{2}(i,5))~=0
     %                       mat5_1(fila)=cell2mat(handles.dfmat{1}(i,5));                            
      %                      mat5_2(fila)=cell2mat(handles.dfmat{2}(i,5));
           %                 fila=fila+1;
  %                      end
         %               i=i+1;
        %            end
     %                plot (mat5_1(:),mat5_2(:),'k.', ...
  %                       [0 max([cell2mat(handles.dfmat{1}(:,5)) cell2mat(handles.dfmat{2}(:,5))])+10],[0 max([cell2mat(handles.dfmat{1}(:,5)) cell2mat(handles.dfmat{2}(:,5))])+10],':k'); 
    %                 xlabel('n_p_o v.1'); ylabel('n_p_o v.2'); 
    %             elseif get(handles.Df_comp_check,'value')==1 
  %                   plot (cell2mat(handles.dfmat{1}(:,6)),cell2mat(handles.dfmat{2}(:,6)),'k.',[1 3],[1 3],':k');
  %                   axis([1 3 1 3]); xlabel('D_f v.1'); ylabel('D_f v.2'); 
     %            elseif get(handles.k_comp_check,'value')==1
   %                  m1=min_fnc(handles.dfmat{1});
     %                m2=min_fnc(handles.dfmat{2});
   %                  minimo=min(m1,m2);
   %                  maximo=round((max(max([cell2mat(handles.dfmat{1}(:,7)) cell2mat(handles.dfmat{2}(:,7))]))+0.1)*10)/10;
  %                   plot (cell2mat(handles.dfmat{1}(:,7)),cell2mat(handles.dfmat{2}(:,7)),'k.',[minimo maximo],[minimo maximo],':k'); 
    %                 axis([minimo maximo minimo maximo]); xlabel('k v.1'); ylabel('k v.2'); 
   %              else
     %                p=fnc_plot(get(get(handles.eje_x_panel,'SelectedObject'),'Tag'),get(get(handles.eje_y_panel,'SelectedObject'),'Tag'),handles.dfmat{1});
       %              set(p,'Color','blue'); hold on;
    %                 [p,igual,x,y]=fnc_plot(get(get(handles.eje_x_panel,'SelectedObject'),'Tag'),get(get(handles.eje_y_panel,'SelectedObject'),'Tag'),handles.dfmat{2});
    %                 if igual==0
      %                   set(p,'Color','red'); legend('v.1','v.2','Location','Best'); handles.leyenda=1;
        %             else
      %                   set(p,'Color','black');
      %               end
        %             fnc_axis(x,y,handles.dfmat);
       %              hold off;
      %           end
            elseif size(handles.version,1)>1 && strcmp(handles.version{1},'2')==1
                handles.nombres_leyenda={}; i=1; colores={'blue','red',[0 0.5 0],[0.5 0 0.5],'magenta'};
                while i<=size(handles.version,1)
                    p=fnc_plot(get(get(handles.eje_x_panel,'SelectedObject'),'Tag'),get(get(handles.eje_y_panel,'SelectedObject'),'Tag'),handles.dfmat{i});
                    set(p,'Color',colores{i}); hold on; 
                    handles.nombres_leyenda{i}=strcat('\delta=',num2str(handles.dfmat{i}{1,13}));
                    if i==size(handles.version,1)
                        [p,igual,x,y]=fnc_plot(get(get(handles.eje_x_panel,'SelectedObject'),'Tag'),get(get(handles.eje_y_panel,'SelectedObject'),'Tag'),handles.dfmat{i});
                        if igual==0
                            set(p,'Color',colores{i}); handles.nombres_leyenda{i}=strcat('\delta=',num2str(handles.dfmat{i}{1,13}));
                            legend(cellstr(handles.nombres_leyenda),'Location','Best'); handles.leyenda=1;
                        else
                            set(p,'Color','black');
                        end
                        fnc_axis(x,y,handles.dfmat);
                        hold off;
                    end
                    i=i+1;
                end
            end
        end
        set(handles.axes1,'visible','on');
    end
 
end
 
%% ---------------------------------------------------------------------------
function [salida,matriz]= fnc_salida(dfmat,Rg,Ap,npo,Df,k,z,J,vol,masa,Asup,media_check,desv_tip_check,version,grupo,estudio)
   
    salida={};               %NUEVA SALIDAS DE DATOS
    matriz={};
    
    if  strcmp(version,'2') && estudio==0
        salida{1,1}=strcat(['Sintering coeff.= ',num2str(dfmat{1,13})]);%!!
    elseif estudio==1                                           %!!%!!%!!%!!%!!%!!               
        salida{1,1}=strcat('');
    end
        
    if grupo==1
        salida{3,1}='n. photo';
        salida{3,2}='Index';
        for j=4:size(dfmat,1)+3
            salida{j+1,1}=dfmat{j-3,1};
            salida{j+1,2}=dfmat{j-3,2};
        end
    else
        salida{3,1}='n. photo';
        for j=4:size(dfmat,1)+3
            salida{j+1,1}=dfmat{j-3,1};
        end
    end
    columna=3;
    
    if Rg==1
        fallo=0;
        salida{3,columna}='Radius of gyration';
        salida{4,columna}='nm';
        for j=4:size(dfmat,1)+3
            salida{j+1,columna}=dfmat{j-3,3};
            if dfmat{j-3,5}~=0
                matriz{j-3-fallo+1,columna-2}=dfmat{j-3,3};
            else
                fallo=fallo+1;
            end
        end
        columna=columna+1;
    end
    
    if Ap==1
        fallo=0;
        salida{3,columna}='Projected area';
        salida{4,columna}='nm^2';
        for j=4:size(dfmat,1)+3
            salida{j+1,columna}=dfmat{j-3,4};
            if dfmat{j-3,5}~=0
                matriz{j-3-fallo+1,columna-2}=dfmat{j-3,4};
            else
                fallo=fallo+1;
            end
        end
        columna=columna+1;
    end
    
    if npo==1
        fallo=0;
        salida{3,columna}='n. primary particles';
        salida{4,columna}='-';
        for j=4:size(dfmat,1)+3
            salida{j+1,columna}=dfmat{j-3,5};
            if dfmat{j-3,5}~=0
                matriz{j-3-fallo+1,columna-2}=dfmat{j-3,5};
            else
                fallo=fallo+1;
            end
        end
        columna=columna+1;
    end
    
    if Df==1
        fallo=0;
        salida{3,columna}='Fractal dimension';
        salida{4,columna}='-';
        for j=4:size(dfmat,1)+3
            salida{j+1,columna}=dfmat{j-3,6};
            if dfmat{j-3,5}~=0
                matriz{j-3-fallo+1,columna-2}=dfmat{j-3,6};
            else
                fallo=fallo+1;
            end
        end
        columna=columna+1;
    end
    
    if k==1
        fallo=0;
        salida{3,columna}='Prefactor';
        salida{4,columna}='-';
        for j=4:size(dfmat,1)+3
            salida{j+1,columna}=dfmat{j-3,7};
            if dfmat{j-3,5}~=0
                matriz{j-3-fallo+1,columna-2}=dfmat{j-3,7};
            else
                fallo=fallo+1;
            end
        end
        columna=columna+1;
    end
    
    %INICIO DE NUEVAS SALIDAS DE DATOS
    
    if z==1
        fallo=0;
        salida{3,columna}='Overlap exponent';
        salida{4,columna}='-';
        for j=4:size(dfmat,1)+3
            salida{j+1,columna}=dfmat{j-3,8}; %
            if dfmat{j-3,5}~=0
                matriz{j-3-fallo+1,columna-2}=dfmat{j-3,8}; %
            else
                fallo=fallo+1;
            end
        end
        columna=columna+1;
    end
    
    if J==1
        fallo=0;
        salida{3,columna}='Coordination number';
        salida{4,columna}='-';
        for j=4:size(dfmat,1)+3
            salida{j+1,columna}=dfmat{j-3,9}; %
            if dfmat{j-3,5}~=0
                matriz{j-3-fallo+1,columna-2}=dfmat{j-3,9}; %
            else
                fallo=fallo+1;
            end
        end
        columna=columna+1;
    end
    
    if vol==1
        fallo=0;
        salida{3,columna}='Agglomerate volume';
        salida{4,columna}='nm^3';
        for j=4:size(dfmat,1)+3
            salida{j+1,columna}=dfmat{j-3,10}; %
            if dfmat{j-3,5}~=0
                matriz{j-3-fallo+1,columna-2}=dfmat{j-3,10}; %
            else
                fallo=fallo+1;
            end
        end
        columna=columna+1;
    end
    
    if masa==1
        fallo=0;
        salida{3,columna}='Agglomerate mass';
        salida{4,columna}='fg';
        for j=4:size(dfmat,1)+3
            salida{j+1,columna}=dfmat{j-3,11}; %
            if dfmat{j-3,5}~=0
                matriz{j-3-fallo+1,columna-2}=dfmat{j-3,11}; %
            else
                fallo=fallo+1;
            end
        end
        columna=columna+1;
    end
    
    if Asup==1
        fallo=0;
        salida{3,columna}='Agglomerate surface area';
        salida{4,columna}='nm^2';
        for j=4:size(dfmat,1)+3
            salida{j+1,columna}=dfmat{j-3,12}; %
            if dfmat{j-3,5}~=0
                matriz{j-3-fallo+1,columna-2}=dfmat{j-3,12}; %
            else
                fallo=fallo+1;
            end
        end
        columna=columna+1;
    end
    
    if estudio==1
        salida{3,columna}='Sintering coeff.';
        salida{4,columna}='-';
        for j=4:size(dfmat,1)+3
            salida{j+1,columna}=dfmat{j-3,13}; %
        end
        columna=columna+1;
    end
    
    salida{3,columna}='Failure';
    salida{4,columna}='-';
    for j=4:size(dfmat,1)+3
        if strcmp(version,'1')==1
            salida{j+1,columna}=dfmat{j-3,13}; %
        elseif strcmp(version,'2')==1 
            salida{j+1,columna}=dfmat{j-3,14}; %
        end
    end  
    
    if media_check==1
        salida{size(salida,1)+2,1}='Average';
        media=mean(cell2mat(matriz));
        for j=3:columna-1
            salida{size(salida,1),j}=media(1,j-2);
        end
    end
    
    if desv_tip_check==1
        if media_check==1
            salida(size(salida,1)+1,1)={'Standard deviation'};
        else
            salida(size(salida,1)+2,1)={'Standard deviation'};
        end
        desv=std(cell2mat(matriz));
        for j=3:columna-1
            salida{size(salida,1),j}=desv(1,j-2);
        end
    end
    
    exito=size(matriz,1);
    
    salida{size(salida,1)+2,1}='n. successful executions';
    salida{size(salida,1),2}=exito-1;
    salida{size(salida,1)+1,1}='n. failed executions';
    salida{size(salida,1),2}=fallo;
end
 
%% ---------------------------------------------------------------------------
function [p,igual,x,y]=fnc_plot(panelx,panely,dfmat)
    igual=0; x=0; y=0;
        switch panelx
            case 'Rg_x_check'
                switch panely
                    case 'Rg_y_check', p=plot (cell2mat(dfmat(:,3)),cell2mat(dfmat(:,3)),'k.'); xlabel('r_g [nm]'); ylabel('r_g [nm]'); igual=1; 
                    case 'Ap_y_check', p=plot (cell2mat(dfmat(:,3)),cell2mat(dfmat(:,4)),'k.'); xlabel('r_g [nm]'); ylabel('A_p [nm^2]'); igual=1;
                    case 'npo_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat3(fila)=cell2mat(dfmat(i,3));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat3(:),mat5(:),'k.'); xlabel('r_g [nm]'); ylabel('n_p_o');
                    case 'Df_y_check', p=plot (cell2mat(dfmat(:,3)),cell2mat(dfmat(:,6)),'k.'); xlabel('r_g [nm]'); ylabel('D_f'); y=1;
                    case 'k_y_check', p=plot (cell2mat(dfmat(:,3)),cell2mat(dfmat(:,7)),'k.'); xlabel('r_g [nm]'); ylabel('k'); y=2;
                    case 'J_y_check', p=plot (cell2mat(dfmat(:,3)),cell2mat(dfmat(:,9)),'k.'); xlabel('r_g [nm]'); ylabel('J'); 
                    case 'volumen_y_check', p=plot (cell2mat(dfmat(:,3)),cell2mat(dfmat(:,10)),'k.'); xlabel('r_g [nm]'); ylabel('V_p [nm^3]'); 
                    case 'masa_y_check', p=plot (cell2mat(dfmat(:,3)),cell2mat(dfmat(:,11)),'k.'); xlabel('r_g [nm]'); ylabel('m_p [fg]'); 
                    case 'Asup_y_check', p=plot (cell2mat(dfmat(:,3)),cell2mat(dfmat(:,12)),'k.'); xlabel('r_g [nm]'); ylabel('A_p [nm^2]');
                end
            case 'Ap_x_check'
                switch panely
                    case 'Rg_y_check', p=plot (cell2mat(dfmat(:,4)),cell2mat(dfmat(:,3)),'k.'); xlabel('A_p [nm^2]'); ylabel('r_g [nm]'); igual=1;
                    case 'Ap_y_check', p=plot (cell2mat(dfmat(:,4)),cell2mat(dfmat(:,4)),'k.'); xlabel('A_p [nm^2]'); ylabel('A_p [nm^2]'); igual=1;
                    case 'npo_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat4(fila)=cell2mat(dfmat(i,4));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat4(:),mat5(:),'k.'); xlabel('A_p [nm^2]'); ylabel('n_p_o');
                    case 'Df_y_check', p=plot (cell2mat(dfmat(:,4)),cell2mat(dfmat(:,6)),'k.'); xlabel('A_p [nm^2]'); ylabel('D_f'); y=1;
                    case 'k_y_check', p=plot (cell2mat(dfmat(:,4)),cell2mat(dfmat(:,7)),'k.'); xlabel('A_p [nm^2]'); ylabel('k'); y=2;
                    case 'J_y_check', p=plot (cell2mat(dfmat(:,4)),cell2mat(dfmat(:,9)),'k.'); xlabel('A_p [nm^2]'); ylabel('J'); 
                    case 'volumen_y_check', p=plot (cell2mat(dfmat(:,4)),cell2mat(dfmat(:,10)),'k.'); xlabel('A_p [nm^2]'); ylabel('V_p [nm^3]'); 
                    case 'masa_y_check', p=plot (cell2mat(dfmat(:,4)),cell2mat(dfmat(:,11)),'k.'); xlabel('A_p [nm^2]'); ylabel('m_p [fg]');
                    case 'Asup_y_check', p=plot (cell2mat(dfmat(:,4)),cell2mat(dfmat(:,12)),'k.'); xlabel('A_p [nm^2]'); ylabel('A_p [nm^2]'); 
                end
            case 'npo_x_check'
                switch panely
                    case 'Rg_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat3(fila)=cell2mat(dfmat(i,3));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat5(:),mat3(:),'k.'); xlabel('n_p_o'); ylabel('r_g [nm]');
                    case 'Ap_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat4(fila)=cell2mat(dfmat(i,4));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat5(:),mat4(:),'k.'); xlabel('n_p_o'); ylabel('A_p [nm^2]');
                    case 'npo_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat5(:),mat5(:),'k.'); xlabel('n_p_o'); ylabel('n_p_o');
                    case 'Df_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat6(fila)=cell2mat(dfmat(i,6));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat5(:),mat6(:),'k.'); xlabel('n_p_o'); ylabel('D_f'); y=1;
                    case 'k_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat7(fila)=cell2mat(dfmat(i,7));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat5(:),mat7(:),'k.'); xlabel('n_p_o'); ylabel('k'); y=2;
                    case 'J_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat9(fila)=cell2mat(dfmat(i,9));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat5(:),mat9(:),'k.'); xlabel('n_p_o'); ylabel('J'); y=3;
                    case 'volumen_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat10(fila)=cell2mat(dfmat(i,10));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat5(:),mat10(:),'k.'); xlabel('n_p_o'); ylabel('V_p [nm^3]'); y=3;
                    case 'masa_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat11(fila)=cell2mat(dfmat(i,11));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat5(:),mat11(:),'k.'); xlabel('n_p_o'); ylabel('m_p [fg]'); y=3;
                    case 'Asup_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat12(fila)=cell2mat(dfmat(i,12));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat5(:),mat12(:),'k.'); xlabel('n_p_o'); ylabel('A_p [nm^2]'); y=3;
                end
            case 'Df_x_check'
                switch panely
                    case 'Rg_y_check', p=plot (cell2mat(dfmat(:,6)),cell2mat(dfmat(:,3)),'k.'); xlabel('D_f'); ylabel('r_g [nm]'); x=1;
                    case 'Ap_y_check', p=plot (cell2mat(dfmat(:,6)),cell2mat(dfmat(:,4)),'k.'); xlabel('D_f'); ylabel('A_p [nm^2]'); x=1;
                    case 'npo_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat6(fila)=cell2mat(dfmat(i,6));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat6(:),mat5(:),'k.'); xlabel('D_f'); ylabel('n_p_o'); x=1;
                    case 'Df_y_check', p=plot (cell2mat(dfmat(:,6)),cell2mat(dfmat(:,6)),'k.'); xlabel('D_f'); ylabel('D_f'); x=1; y=1;
                    case 'k_y_check', p=plot (cell2mat(dfmat(:,6)),cell2mat(dfmat(:,7)),'k.'); xlabel('D_f'); ylabel('k'); x=1; y=2;
                    case 'J_y_check', p=plot (cell2mat(dfmat(:,6)),cell2mat(dfmat(:,9)),'k.'); xlabel('D_f'); ylabel('J');x=1; y=0;
                    case 'volumen_y_check', p=plot (cell2mat(dfmat(:,6)),cell2mat(dfmat(:,10)),'k.'); xlabel('D_f'); ylabel('V_p [nm^3]');x=1; y=0;
                    case 'masa_y_check', p=plot (cell2mat(dfmat(:,6)),cell2mat(dfmat(:,11)),'k.'); xlabel('D_f'); ylabel('m_p [fg]');x=1; y=0;
                    case 'Asup_y_check', p=plot (cell2mat(dfmat(:,6)),cell2mat(dfmat(:,12)),'k.'); xlabel('D_f'); ylabel('A_p [nm^2]');x=1; y=0;
                end
            case 'k_x_check'
                switch panely
                    case 'Rg_y_check', p=plot (cell2mat(dfmat(:,7)),cell2mat(dfmat(:,3)),'k.'); xlabel('k'); ylabel('r_g [nm]'); x=2;
                    case 'Ap_y_check', p=plot (cell2mat(dfmat(:,7)),cell2mat(dfmat(:,4)),'k.'); xlabel('k'); ylabel('A_p [nm^2]'); x=2;
                    case 'npo_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat7(fila)=cell2mat(dfmat(i,7));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat7(:),mat5(:),'k.'); xlabel('k'); ylabel('n_p_o'); x=2;
                    case 'Df_y_check', p=plot (cell2mat(dfmat(:,7)),cell2mat(dfmat(:,6)),'k.'); xlabel('k'); ylabel('D_f'); x=2; y=1;
                    case 'k_y_check', p=plot (cell2mat(dfmat(:,7)),cell2mat(dfmat(:,7)),'k.'); xlabel('k'); ylabel('k'); x=2; y=2;
                    case 'J_y_check', p=plot (cell2mat(dfmat(:,7)),cell2mat(dfmat(:,9)),'k.'); xlabel('k'); ylabel('J'); y=0;
                    case 'volumen_y_check', p=plot (cell2mat(dfmat(:,7)),cell2mat(dfmat(:,10)),'k.'); xlabel('k'); ylabel('V_p [nm^3]'); y=0;
                    case 'masa_y_check', p=plot (cell2mat(dfmat(:,7)),cell2mat(dfmat(:,11)),'k.'); xlabel('k'); ylabel('m_p [fg]'); y=0;
                    case 'Asup_y_check', p=plot (cell2mat(dfmat(:,7)),cell2mat(dfmat(:,12)),'k.'); xlabel('k'); ylabel('A_p [nm^2]'); y=0;
                end
            case 'J_x_check'
                switch panely
                    case 'Rg_y_check', p=plot (cell2mat(dfmat(:,9)),cell2mat(dfmat(:,3)),'k.'); xlabel('J'); ylabel('r_g [nm]'); x=0;
                    case 'Ap_y_check', p=plot (cell2mat(dfmat(:,9)),cell2mat(dfmat(:,4)),'k.'); xlabel('J'); ylabel('A_p [nm^2]'); x=0;
                    case 'npo_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat9(fila)=cell2mat(dfmat(i,9));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat9(:),mat5(:),'k.'); xlabel('J'); ylabel('n_p_o'); x=2;
                    case 'Df_y_check', p=plot (cell2mat(dfmat(:,9)),cell2mat(dfmat(:,6)),'k.'); xlabel('J'); ylabel('D_f'); x=0; y=1;
                    case 'k_y_check', p=plot (cell2mat(dfmat(:,9)),cell2mat(dfmat(:,7)),'k.'); xlabel('J'); ylabel('k'); x=0; y=2;
                    case 'J_y_check', p=plot (cell2mat(dfmat(:,9)),cell2mat(dfmat(:,9)),'k.'); xlabel('J'); ylabel('J'); y=0;
                    case 'volumen_y_check', p=plot (cell2mat(dfmat(:,9)),cell2mat(dfmat(:,10)),'k.'); xlabel('J'); ylabel('V_p [nm^3]'); y=0;
                    case 'masa_y_check', p=plot (cell2mat(dfmat(:,9)),cell2mat(dfmat(:,11)),'k.'); xlabel('J'); ylabel('m_p [fg]'); y=0;
                    case 'Asup_y_check', p=plot (cell2mat(dfmat(:,9)),cell2mat(dfmat(:,12)),'k.'); xlabel('J'); ylabel('A_p [nm^2]'); y=0;
                end
            case 'volumen_x_check'
                switch panely
                    case 'Rg_y_check', p=plot (cell2mat(dfmat(:,10)),cell2mat(dfmat(:,3)),'k.'); xlabel('V_p [nm^3]'); ylabel('r_g [nm]'); x=0;
                    case 'Ap_y_check', p=plot (cell2mat(dfmat(:,10)),cell2mat(dfmat(:,4)),'k.'); xlabel('V_p [nm^3]'); ylabel('A_p [nm^2]'); x=0;
                    case 'npo_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat10(fila)=cell2mat(dfmat(i,10));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat10(:),mat5(:),'k.'); xlabel('V_p [nm^3]'); ylabel('n_p_o'); x=2;
                    case 'Df_y_check', p=plot (cell2mat(dfmat(:,10)),cell2mat(dfmat(:,6)),'k.'); xlabel('V_p [nm^3]'); ylabel('D_f'); x=0; y=1;
                    case 'k_y_check', p=plot (cell2mat(dfmat(:,10)),cell2mat(dfmat(:,7)),'k.'); xlabel('V_p [nm^3]'); ylabel('k'); x=0; y=2;
                    case 'J_y_check', p=plot (cell2mat(dfmat(:,10)),cell2mat(dfmat(:,9)),'k.'); xlabel('V_p [nm^3]'); ylabel('J'); y=0;
                    case 'volumen_y_check', p=plot (cell2mat(dfmat(:,10)),cell2mat(dfmat(:,10)),'k.'); xlabel('V_p [nm^3]'); ylabel('V_p [nm^3]'); y=0;
                    case 'masa_y_check', p=plot (cell2mat(dfmat(:,10)),cell2mat(dfmat(:,11)),'k.'); xlabel('V_p [nm^3]'); ylabel('m_p [nm^3]'); y=0;
                    case 'Asup_y_check', p=plot (cell2mat(dfmat(:,10)),cell2mat(dfmat(:,12)),'k.'); xlabel('V_p [nm^3]'); ylabel('A_p [nm^2]'); y=0;
                end
            case 'masa_x_check'
                switch panely
                    case 'Rg_y_check', p=plot (cell2mat(dfmat(:,11)),cell2mat(dfmat(:,3)),'k.'); xlabel('m_p [fg]'); ylabel('r_g [nm]'); x=0;
                    case 'Ap_y_check', p=plot (cell2mat(dfmat(:,11)),cell2mat(dfmat(:,4)),'k.'); xlabel('m_p [fg]'); ylabel('A_p [nm^2]'); x=0;
                    case 'npo_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat11(fila)=cell2mat(dfmat(i,11));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat11(:),mat5(:),'k.'); xlabel('m_p [fg]'); ylabel('n_p_o'); x=2;
                    case 'Df_y_check', p=plot (cell2mat(dfmat(:,11)),cell2mat(dfmat(:,6)),'k.'); xlabel('m_p [fg]'); ylabel('D_f'); x=0; y=1;
                    case 'k_y_check', p=plot (cell2mat(dfmat(:,11)),cell2mat(dfmat(:,7)),'k.'); xlabel('m_p [fg]'); ylabel('k'); x=0; y=2;
                    case 'J_y_check', p=plot (cell2mat(dfmat(:,11)),cell2mat(dfmat(:,9)),'k.'); xlabel('m_p [fg]'); ylabel('J'); y=0;
                    case 'volumen_y_check', p=plot (cell2mat(dfmat(:,11)),cell2mat(dfmat(:,10)),'k.'); xlabel('m_p [fg]'); ylabel('V_p [nm^3]'); y=0;
                    case 'masa_y_check', p=plot (cell2mat(dfmat(:,11)),cell2mat(dfmat(:,11)),'k.'); xlabel('m_p [fg]'); ylabel('m_p [fg]'); y=0;
                    case 'Asup_y_check', p=plot (cell2mat(dfmat(:,11)),cell2mat(dfmat(:,12)),'k.'); xlabel('m_p [fg]'); ylabel('A_p [nm^2]'); y=0;
                end
            case 'Asup_x_check'
                switch panely
                    case 'Rg_y_check', p=plot (cell2mat(dfmat(:,12)),cell2mat(dfmat(:,3)),'k.'); xlabel('A_p [nm^2]'); ylabel('r_g [nm]'); x=0;
                    case 'Ap_y_check', p=plot (cell2mat(dfmat(:,12)),cell2mat(dfmat(:,4)),'k.'); xlabel('A_p [nm^2]'); ylabel('A_p [nm^2]'); x=0;
                    case 'npo_y_check'
                        fila=1;i=1;
                        while i<=size(dfmat,1)
                            if cell2mat(dfmat(i,5))~=0
                                mat12(fila)=cell2mat(dfmat(i,12));
                                mat5(fila)=cell2mat(dfmat(i,5));
                                fila=fila+1;
                            end
                            i=i+1;
                        end
                        p=plot (mat12(:),mat5(:),'k.'); xlabel('A_p [nm^2]'); ylabel('n_p_o'); x=2;
                    case 'Df_y_check', p=plot (cell2mat(dfmat(:,12)),cell2mat(dfmat(:,6)),'k.'); xlabel('A_p [nm^2]'); ylabel('D_f'); x=0; y=1;
                    case 'k_y_check', p=plot (cell2mat(dfmat(:,12)),cell2mat(dfmat(:,7)),'k.'); xlabel('A_p [nm^2]'); ylabel('k'); x=0; y=2;
                    case 'J_y_check', p=plot (cell2mat(dfmat(:,12)),cell2mat(dfmat(:,9)),'k.'); xlabel('A_p [nm^2]'); ylabel('J'); y=0;
                    case 'volumen_y_check', p=plot (cell2mat(dfmat(:,12)),cell2mat(dfmat(:,10)),'k.'); xlabel('A_p [nm^2]'); ylabel('V_p [nm^3]'); y=0;
                    case 'masa_y_check', p=plot (cell2mat(dfmat(:,12)),cell2mat(dfmat(:,11)),'k.'); xlabel('A_p [nm^2]'); ylabel('m_p [fg]'); y=0;
                    case 'Asup_y_check', p=plot (cell2mat(dfmat(:,12)),cell2mat(dfmat(:,12)),'k.'); xlabel('A_p [nm^2]'); ylabel('A_p [nm^2]'); y=0;
                end
        end
end
 
%% ---------------------------------------------------------------------------
function [minimo]=min_fnc(dfmat)
    for i=1:size(dfmat,1)
        m=cell2mat(dfmat(i,7));
        if i==1
            min_mat=m;
        end
        if m~=0 && i>1
            min_mat=min(min_mat,m);
        end
    end
                
    minimo=round((min(min_mat)-0.1)*10)/10;
end
 
%% ---------------------------------------------------------------------------
function fnc_axis(x,y,dfmat)
    if x==0
        if y==1
            axis([0 5 1 3]); axis('auto x');
        elseif y==2
            if length(dfmat)>5
                vectormin=min_fnc(dfmat);
                vectormax=round((max(cell2mat(dfmat(:,7)))+0.1)*10)/10;
            else
                for i=1:length(dfmat)
                    vectormin(i)=min_fnc(dfmat{i});
                end
                for i=1:length(dfmat)
                    vectormax(i)=round((max(cell2mat(dfmat{i}(:,7)))+0.1)*10)/10;
                end
            end
            axis([0,5,min(vectormin),max(vectormax)]); axis('auto x');
        else
            axis('auto xy');
        end
    elseif x==1
        if y==1
            axis([1 3 1 3]);
        elseif y==2
            for i=1:length(dfmat)
                vectormin(i)=min_fnc(dfmat{i});
            end
            for i=1:length(dfmat)
                vectormax(i)=round((max(cell2mat(dfmat{i}(:,7)))+0.1)*10)/10;
            end
            axis([1,3,min(vectormin),max(vectormax)]);
        else
            axis([1 3 0 5]); axis('auto y');
        end
    elseif x==2
        for i=1:length(dfmat)
        	vectormin(i)=min_fnc(dfmat{i});
        end
        for i=1:length(dfmat)
        	vectormax(i)=round((max(cell2mat(dfmat{i}(:,7)))+0.1)*10)/10;
        end
        if y==1
            axis([min(vectormin),max(vectormax),1,3]);
        elseif y==2
            axis([min(vectormin),max(vectormax),min(vectormin),max(vectormax)]);
        else
            axis([min(vectormin),max(vectormax),0,5]); axis('auto y');
        end
    end
end
  
%% ---------------------------------------------------------------------------
    function tomar_aplast_boton_Callback(~,~,handles)
   
    handles.grupo=getappdata(0,'grupo');
    
        deltas=[];
        for i=1:size(handles.dfmat,1)
            deltas(i)=handles.dfmat{i}{1,13}; %NUEVO CAMBIO
        end
        delta=str2double(get(handles.nueva_delta_entrada,'String'));
            
        if delta<1 || delta>(2/sqrt(3))
            dlgerror=errordlg('El valor de delta debe de estar entre 1 y 1.15','Error');
                kids0=findobj(dlgerror,'Type','UIControl');
                kids1=findobj(dlgerror,'Type','Text');
 
                % change the font and fontsize
                extent0=get(kids1,'Extent'); % text extent in old font
                set([kids0,kids1],'FontName','Candara','FontSize',12);
                set(kids0,'Foregroundcolor',[0.4 0.3 1]);
                extent1=get(kids1,'Extent'); % text extent in new font
 
                % need to resize the msgbox object to accommodate new FontName
                % and FontSize
                dlgdelta=extent1-extent0; % change in extent
            
                pos=get(kids0,'Position'); % msgbox current position
                pos=pos+dlgdelta; % change size of msgbox
                set(kids0,'Position',pos); % set new position
            
                pos=get(dlgerror,'Position'); % msgbox current position
                pos=pos+dlgdelta; % change size of msgbox
                set(dlgerror,'Position',pos); % set new position
                
            set(handles.nueva_delta_entrada,'String','NaN');
        elseif any(delta==deltas)==1
            dlgerror=errordlg('El valor de delta escogido ya existe','Error');
                kids0=findobj(dlgerror,'Type','UIControl');
                kids1=findobj(dlgerror,'Type','Text');
 
                % change the font and fontsize
                extent0=get(kids1,'Extent'); % text extent in old font
                set([kids0,kids1],'FontName','Candara','FontSize',12);
                set(kids0,'Foregroundcolor',[0.4 0.3 1]);
                extent1=get(kids1,'Extent'); % text extent in new font
 
                % need to resize the msgbox object to accommodate new FontName
                % and FontSize
                dlgdelta=extent1-extent0; % change in extent
            
                pos=get(kids0,'Position'); % msgbox current position
                pos=pos+dlgdelta; % change size of msgbox
                set(kids0,'Position',pos); % set new position
            
                pos=get(dlgerror,'Position'); % msgbox current position
                pos=pos+dlgdelta; % change size of msgbox
                set(dlgerror,'Position',pos); % set new position
                
            set(handles.nueva_delta_entrada,'String','NaN');
        else
            foto=getappdata(0,'foto');
            nfoto=getappdata(0,'nfoto');
            npixescala=getappdata(0,'npixescala');
            dpomat=getappdata(0,'dpomat');
            grupo=getappdata(0,'grupo');
            %FALLO CORREGIDO
            if handles.grupo==1
                dfmat=GeneralExe2012grupo(foto,nfoto,npixescala,dpomat,grupo,delta);
            else
                dfmat=GeneralExe2012individual(foto,nfoto,npixescala,dpomat,grupo,delta);
            end
            
            handles.dfmat{size(handles.dfmat,1)+1,1}=dfmat; setappdata(0,'dfmat',handles.dfmat);
            handles.version{size(handles.version,1)+1,1}='2'; setappdata(0,'version',handles.version);
        
            handles.n_veces_nuevo_aplast=handles.n_veces_nuevo_aplast+1; setappdata(0,'n_veces_nuevo_aplast',handles.n_veces_nuevo_aplast);
            
            close;
        end
    end
        
%http://www.mathworks.es/matlabcentral/answers/89523-how-to-print-the-figure-of-an-axes-from-a-gui-to-excel
 
% app=getappdata(0); %get all the appdata of 0
% %and then
% appdatas = fieldnames(app);
% for kA = 1:length(appdatas)
%   rmappdata(0,appdatas{kA});
% end