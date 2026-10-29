function FRAKTAL
% DATOS_IMAGENES_BUILD
%-------------------------------------------------------------------------------
% File name   : presentacion_build.m
%-------------------------------------------------------------------------------


% Initialize handles structure
handles = struct();

% Create all UI controls
build_gui();

%% ---------------------------------------------------------------------------
	function build_gui()
% Creation of all uicontrols

		% --- FIGURE -------------------------------------
		handles.figura_presentacion = figure( ...
			'Tag', 'figura_presentacion', ...
            'Units','Pixels',...
            'Position',[0 0 1340 700],...
			'Name', 'Presentación', ...
			'MenuBar', 'none', ...
			'NumberTitle', 'off', ...
			'Color', get(0,'DefaultUicontrolBackgroundColor'));

		% --- BACKGROUND -------------------------------------
        
        handles.img_fondo_axes = axes( ...
        	'Units','Normalized',...
        	'Position',[0 0 1 1]);
            
            [x,map]=imread('Fractal_inicio.jpg','jpg');
            image(x),colormap(map),axis off,hold on
            
        % --- STATIC TEXTS -------------------------------------
        
        text(505,515,'FRAKTAL 2.1','Fontsize',70,'Fontweight','Bold','FontName','Candara','color',[1 1 1]);
            
        text(45,650,'Realizado por: Enrique Viera Luis (2014)','Fontsize',18,'FontName','Candara','color',[1 1 1]);
        
        text(45,720,'Modificado por: Gonzalo Moya Plaza (2018)','Fontsize',18,'FontName','Candara','color',[1 1 1]);
        
        text(45,790,'Corregido por: Juan José Expósito González (2021)','Fontsize',18,'FontName','Candara','color',[1 1 1]);
            
        text(45,860,'Dirigido por: Magín Lapuerta Amigo','Fontsize',18,'FontName','Candara','color',[1 1 1]);
            
        % --- IMAGES -------------------------------------------
        
        handles.uclm_axes = axes( ...
			'Parent', handles.figura_presentacion, ...
			'Tag', 'uclm_axes', ...
			'Units', 'characters', ...
            'visible', 'off', ...
			'Position', [20 38 60 10]);
        
            set(handles.uclm_axes,'visible','on');
            axes(handles.uclm_axes)
            background = imread('Logo_uclm.png');
            axis off;
            imshow(background);
        
        handles.motores_axes = axes( ...
			'Parent', handles.figura_presentacion, ...
			'Tag', 'motores_axes', ...
			'Units', 'characters', ...
            'visible', 'off', ...
			'Position', [213 36 26 15]);
        
            set(handles.motores_axes,'visible','on');
            axes(handles.motores_axes)
            background = imread('Logo_amt.png');
            axis off;
            imshow(background);
        
        % --- PUSHBUTTONS -------------------------------------
		
        handles.espanol_boton = uicontrol( ...
			'Parent', handles.figura_presentacion, ...
			'Tag', 'español_boton', ...
			'Style', 'pushbutton', ...
			'Units', 'characters', ...
			'Position', [210 4 15 5], ...
            'Callback', @espanol_boton_Callback);
        
        [a,~]=imread('español.png');
        [r,c,~]=size(a);
        x=ceil(r/30);
        y=ceil(c/50);
        g=a(1:x:end,1:y:end,:);
        g(g==255)=5.5*255;
        set(handles.espanol_boton,'CData',g);
        
        handles.english_boton = uicontrol( ...
			'Parent', handles.figura_presentacion, ...
			'Tag', 'english_boton', ...
			'Style', 'pushbutton', ...
			'Units', 'characters', ...
			'Position', [230 4 15 5], ...
            'Callback', @english_boton_Callback);
        
        [a,~]=imread('english.png');
        [r,c,~]=size(a);
        x=ceil(r/30);
        y=ceil(c/50);
        g=a(1:x:end,1:y:end,:);
        g(g==255)=5.5*255;
        set(handles.english_boton,'CData',g);
        
    movegui(handles.figura_presentacion,'center')

    end

%% ---------------------------------------------------------------------------
	function espanol_boton_Callback(hObject,evendata) %#ok<INUSD>
        close;
        Tipo_fractal_build;
    end

%% ---------------------------------------------------------------------------
	function english_boton_Callback(hObject,evendata) %#ok<INUSD>
        close;
        Tipo_fractal_english_build;
    end

end