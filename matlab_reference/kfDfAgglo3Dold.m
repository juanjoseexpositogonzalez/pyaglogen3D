function [ clusters, referencias, intentos, vec, deltas, total_rot ] = kfDfAgglo3Dold( nop, dpo, solape, kf, Df, metodo )

%% Variables iniciales
semilla = 2;            % Número de particulas del aglomerado inicial
max_rotaciones = 25;    % Maximo número de rotaciones
%% Creamos el cluster inicial de dos particulas
[ cluster, referencia, intentos, ~, deltas ] = agloGen3D( semilla, dpo( 1 ), solape, metodo );
referencias = cell( nop, 1 );
referencias( 1 : 2, 1 ) = referencia;
clusters = cell( nop, 1 );
% Sembramos la semilla para aleatorizar
rng( 'shuffle' ); 
for np = 1 : semilla
    clusters{ np, 1 } = [ 1 np cluster( np, : ) ];
end
total_rot = ones( nop, 1 );

%% Resto de aglomerado
for np = 3 : nop
    %% Calculo de la distancia a la que debe colocarse la siguiente partícula
    if ( numel( dpo ) > 1 ) 
        gamma = sqrt( ( ( np ^ 2 * ( dpo( np ) / 2 ) ^ 2 ) / ( np - 1 ) ) * ( np / kf ) ^ ( 2 / Df ) - ...
            ( ( np * ( dpo( np ) / 2 ) ^ 2 ) / ( np - 1 ) ) - ...
            ( np * ( dpo( np ) / 2 ) ^ 2 )  * ( ( np - 1 ) / kf ) ^ ( 2 / Df ) );
        % Condicion para las particulas en la lista LA   
        distancia2 = max( gamma - mean( dpo( 1 : np - 1 ) ), 0 );
    else
        gamma = sqrt( ( ( np ^ 2 * ( dpo / 2 ) ^ 2 ) / ( np - 1 ) ) * ( np / kf ) ^ ( 2 / Df ) - ...
            ( ( np * ( dpo / 2 ) ^ 2 ) / ( np - 1 ) ) - ...
            ( np * ( dpo / 2 ) ^ 2 )  * ( ( np - 1 ) / kf ) ^ ( 2 / Df ) );
        % Condicion para las particulas en la lista LA   
        distancia2 = max( gamma - dpo, 0 );
    end
            
    %% Creamos la lista de partículas (LA) que potencialmente podrían interferir con la nueva
    distACentroAglo = sqrt( sum( cluster( 1 : np - 1, 1 : 3 ) .^ 2, 2 ) );
    LA = find( distACentroAglo > distancia2 );
    % Inicializamos la variable choque para comprobar que haya un choque    
    choque = 0;    
    % Para evitar elegir dos veces sucesivas la misma particula la eliminamos las que ya han
    % sido probadas y para las cuales se ha superado el numero maximo de intentos
    probadas = [ ];    
    while ( choque == 0 )
        % Inicializamos la variable para contar el numero de rotaciones
        contador_rot = 1;
        % Actualizamos LA
        LA = setdiff( LA, probadas );
        %% Elegimos una particula al azar dentro del conjunto LA (si hay mas de una)
        if numel( LA ) >= 1
            candidata = LA( randi( [ 1, numel( LA ) ] ) );
        end
        CB = cluster( candidata, 1 : 3 );
        CBmod = norm( CB );
        %% Calculamos el angulo alpha
        if numel( dpo ) > 1 
            alpha = acos( ( gamma ^ 2 + CBmod ^ 2 - ( dpo( np ) / 2 + dpo( candidata ) / 2 ) ^ 2 ) / ...
                ( 2 * gamma * CBmod ) );
        else
            alpha = acos( ( gamma ^ 2 + CBmod ^ 2 - ( dpo ) ^ 2 ) / ( 2 * gamma * CBmod ) );
        end
        
        %% Determinamos el angulo beta al azar
        beta = unifrnd( 0, 2 * pi( ) );

        %% Determinamos un vector unitario T1 para poder rotar el vector CB alpha grados
        % Primero determinamos una direccion aleatoria
        [ ~, ~, a, b, c ] = determineAngles( 1 );
        T1 = [ a b c ];
        % Calculamos el producto vectorial        
        T2 = cross( T1, CB );
        while norm( T2 ) == 0
            [ ~, ~, a, b, c ] = determineAngles( 1 );
            T1 = [ a b c ];
            T2 = cross( T1, CB );
        end
        % Hacemos T2 unitario
        T2u = T2 / norm( T2 );
        % Construccion del cuaternio
        T2u = T2u * sin( alpha / 2 );
        Qalpha = [ cos( alpha / 2 ) T2u( 1 : 3 ) ];
        % Ahora hay que rotar el vector CB alrededor de T2u alpha grados, por lo que primero
        % construimos un vector en la direccion de CB que tenga el modulo de gamma
        CBrot = CB / CBmod * gamma;
        % Rotamos
        CA = multiplica_cuaternion( Qalpha, multiplica_cuaternion( [ 0 CBrot ], conjugar_cuaternio( Qalpha ) ) );
        % Codificamos la rotacion beta en un cuaternio
        CBu = CB / CBmod;
        CBu = CBu * sin( beta / 2 );
        Qbeta = [ cos( beta / 2 ) CBu ];
        
%         h = plotAgglomerate( cluster ); xlabel('X'), ylabel('Y'), zlabel('Z');
%         for ttt = 1 : numel( h )
%             set(h(ttt),'FaceAlpha',0)
%         end
%         T1 = T1 / norm( T1 ) * norm( CB );
%         T2 = T2 / norm( T2 ) * norm( CB );
%         hold on; 
%         quiver3( 0, 0, 0, T1(1),T1(2),T1(3), 'Color', 'Red'),xlabel('X'),ylabel('Y'),zlabel('Z')
%         text( T1(1), T1(2),T1(3), 'T1' );
%         quiver3( 0, 0, 0, T2(1),T2(2),T2(3), 'Color', 'Green' )
%         text( T2(1), T2(2),T2(3), 'T2' );
%         quiver3( 0, 0, 0, CB(1), CB(2), CB(3), 'Color', 'Blue')
%         text( CB(1), CB(2),CB(3), 'CB' );
%         quiver3( 0, 0, 0, CA(2), CA(3), CA(4), 'Color', 'Black', 'LineWidth', 2)
%         text( CA(2), CA(3), CA(4), 'CA' );
        
        % Rotamos CA en dicha direccion
        while ( contador_rot < max_rotaciones )
            CA = multiplica_cuaternion( Qbeta ,multiplica_cuaternion( CA, conjugar_cuaternio( Qbeta ) ) );
            if numel( dpo ) > 1
                CA = [ CA( 2 : end ) dpo( np ) / 2 ];
            else
                CA = [ CA( 2 : end ) dpo / 2 ];
            end
            CA( 1 : 3 ) = CA( 1 : 3 ) / norm( CA( 1 : 3 ) ) * gamma;
            assert( norm( CA( 1 : 3 ) ) - gamma < 1e-10 );
%             quiver3( 0, 0, 0, CA(1), CA(2), CA(3), 'Color', 'Cyan', 'LineWidth', 3 )
%             text( CA(1), CA(2), CA(3), 'CArot' );
            % Ahora corregimos las coordenadas para que este la particula exactamente a la
            % distancia que debe estar de la candidata
%             if norm( cluster( candidata, : ) - CA ) ~= ( cluster( candidata, 4 ) + CA( 4 ) )
%                 % Corregimos las coordenadas
%                 v = cluster( candidata, 1 : 3 ) - CA( 1 : 3 );
%                 v = v / norm( v );
%                 desplazamiento = norm( cluster( candidata, : ) - CA ) - ( cluster( candidata, 4 ) + CA( 4 ) );
%                 CA( 1 : 3 ) = CA( 1 : 3 ) + v * desplazamiento;
%             end
            %% Comprobamos la condicion de solape hasta que no podamos rotar mas
            % Construmos la lista LB
            centrosLA = cluster( LA, 1 : 3 );
            radiosLA =  cluster( LA, 4 );
            solapes_posibles = centrosLA - repmat( CA( 1 : 3 ), size( centrosLA, 1 ), 1 );
%             for ttt = 1 : size( centrosLA, 1 )
%                 quiver3( centrosLA( ttt, 1 ), centrosLA( ttt, 2 ), centrosLA( ttt, 3 ), ...
%                    CA(1) - centrosLA(ttt,1), CA(2) - centrosLA(ttt,2), CA(3) - centrosLA(ttt,3), ...
%                    'Color', 'Yellow', 'LineWidth', 3 );
%             end
            suma_radios = radiosLA + repmat( CA( 4 ), size( radiosLA, 1 ), 1 );
            solapes_posibles = sqrt( sum( solapes_posibles .^ 2, 2 ) );
            LB = find( solapes_posibles < suma_radios );            
            % Eliminamos la candidata de la lista de LB (si está)
            LB = setdiff( LB, candidata );
            if numel( LB ) == 0
                choque = 1;
                total_rot( np, 1 ) = contador_rot;
                contador_rot = max_rotaciones;
                % Actualizamos los vectores de clusters con las coordenadas desplazadas según
                % el centro geometrico
                cluster = [ cluster; CA ]; %#ok<*AGROW>
                geomCenter = calculateGeometricalCentre( cluster );
                cluster = posicionarCluster( cluster, geomCenter );
                % Actualizamos convenientemente la celda clusters
                for ss = 1 : np
                    clusters{ ss, 1 } = [ 1 np cluster( ss, : ) ];
                end
                % Actualizamos los centros de gravedad, radio máximo y radio de giro para este cluster, el
                % centro geometrico sigue siendo el [ 0 0 0 ] para cada cluster
                referencias{ np }{ 1 } = np;
                referencias{ np }{ 2 }( 2, 1 : 3 ) = calculateCentreOfGravity( cluster );
                referencias{ np }{ 2 }( 1, 1 : 3 ) = geomCenter;
                referencias{ np }{ 2 }( 1, 4 ) = determineMaximumDiameter( clusters, np, referencias );
                referencias{ np }{ 2 }( 2, 4 ) = calculateRadiusOfGyration( clusters, np, referencias );
            else
                % Hay algun solape y por tanto debemos volver a codificar la rotacion,
                % variamos el angulo beta en una cantidad determinada (nos aseguramos que
                % recorremos los 360º para evitar solape)                
                beta = beta + ( contador_rot / ( max_rotaciones + 1 ) ) * 2 * pi( );
                CBu = CB / CBmod;
                CBu = CBu * sin( beta / 2 );
                Qbeta = [ cos( beta / 2 ) CBu ];
                contador_rot = contador_rot + 1;
            end            
        end % while contador_rot 
        probadas = [ probadas candidata ];
    end % while choque
end % for

%% Preparamos la salida
vec = determinarVecindad( clusters );
clusters = cell2mat( clusters );
clusters = clusters( :, 2 : end );
